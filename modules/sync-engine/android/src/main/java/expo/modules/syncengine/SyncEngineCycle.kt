package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.util.Log
import java.util.UUID

private const val TAG = "SyncEngineCycle"

/** The deduped backlog batch size; mirrors `RECONCILE_BACKLOG_BATCH_LIMIT`. */
private const val BACKLOG_BATCH_LIMIT = 200

/** Request budget for the bridge POST; mirrors `BRIDGE_REQUEST_TIMEOUT_MS`. */
private const val BRIDGE_REQUEST_TIMEOUT_MS = 10_000

/** Cursor sanity bound, mirroring `MAX_REASONABLE_CHANGELOG_ID`. */
private const val MAX_REASONABLE_CHANGELOG_ID = 1_000_000_000_000L

private const val BACKLOG_QUERY =
  "SELECT id, animeId, operation, payload, status, createdAt, conflictAttemptCount FROM (" +
    "  SELECT" +
    "    id," +
    "    anime_id AS animeId," +
    "    operation," +
    "    payload," +
    "    status," +
    "    created_at AS createdAt," +
    "    conflict_attempt_count AS conflictAttemptCount," +
    "    ROW_NUMBER() OVER (" +
    "      PARTITION BY anime_id ORDER BY created_at ASC, id ASC" +
    "    ) AS animeRank" +
    "  FROM operation_log" +
    "  WHERE status IN (?, ?)" +
    ")" +
    "WHERE animeRank = 1" +
    " ORDER BY createdAt ASC, id ASC" +
    " LIMIT ?"

/** One terminal attempt result the module maps onto the JS-facing result dictionary. */
data class CycleOutcome(
  val outcome: String,
  val stage: String,
  val syncedCount: Int,
  val backlogReadCount: Int,
  val errorName: String?,
  /** `processing` rows the recovery sweep returned to `pending`; 0 when none. */
  val recoveredProcessingCount: Int = 0,
  /** Cycle id the sweep marked `abandoned`, or `null` when there was nothing to abandon. */
  val recoveredAbandonedCycleId: String? = null,
) {
  /** Builds the result dictionary the Expo bridge delivers to the JS seam. */
  fun toMap(cycleId: String): Map<String, Any?> = mapOf(
    "outcome" to outcome,
    "cycleId" to cycleId,
    "syncedCount" to syncedCount,
    "backlogReadCount" to backlogReadCount,
    "stage" to stage,
    "errorName" to errorName,
    "recoveredProcessingCount" to recoveredProcessingCount,
    "recoveredAbandonedCycleId" to recoveredAbandonedCycleId,
  )
}

/**
 * One native sync attempt, ported step by step from the JS cycle
 * (`headless-sync-cycle.helpers.ts` + `reconcile.helpers.ts` in `staged` mode) with the exact
 * semantics each step's TypeScript reference defines. Differences are deliberate and named:
 * - the no-config case returns `not_applicable` instead of throwing (a background attempt is a
 *   probe, not a user-facing failure);
 * - the conflict-exhaustion policy (attempt caps and the token re-base) and the full
 *   `client_telemetry` envelope are DEFERRED, not silently skipped: conflicts fall back to the
 *   generic "reset to pending" retry;
 * - the diagnostics flush (`POST /api/sync/diagnostics`) is NOT deferred any more: the attempt
 *   delivers stored envelopes through [SyncEngineDiagnosticsCourier] once the lease is held and
 *   before it reads the backlog, on both the claimed and the pull-only path. It is deliberately
 *   outside the journal and outside the outcome -- a delivery failure is never a cycle failure;
 * - the empty-backlog attempt still reconciles: with nothing to claim or send, the reconcile
 *   request is still issued pull-only, exactly like the JS no-op attempt (the JS cycle's
 *   `syncPendingOperations` always runs, so remote changes arrive without anything to push).
 *
 * Journal discipline (docs/mobile-sync-architecture.md 6.2/6.3): every transition row is
 * appended BEFORE the effect it names, so an attempt parked inside a native call reports the
 * state it parked in. `not_applicable` is journaled as a transition INTO that outcome state.
 */
class SyncEngineCycle(
  private val appDb: SQLiteDatabase,
  private val journal: SyncEngineJournal,
  private val diagnostics: SyncEngineDiagnosticsCourier = SyncEngineDiagnosticsCourier.forAppDatabase(appDb),
) {
  private val lease = SyncCycleLease(appDb)

  /**
   * Shared response-apply step: the claimed path and the pull-only empty path both stage the
   * parsed response through it, so the two paths cannot drift.
   */
  private val responseApplier =
    SyncEngineResponseApplier(appDb, this::updateOperationStatus)
  private var cycleId: String = ""
  private var lastState: String = "idle"
  private var claimedRows: List<BacklogRow> = emptyList()
  private var onState: (String) -> Unit = {}

  /**
   * The owner/fence pair this attempt writes under, set by a successful claim and cleared when
   * a fenced write proves the lease was reclaimed. Every destructive or monotonic write below is
   * guarded by it -- see [requireOwned] and [updateOperationStatus].
   */
  private var leaseFence: LeaseFence? = null

  /**
   * What this attempt's recovery sweep reclaimed, after the lease was held. Defaults to
   * "nothing" so an outcome built before the sweep ran (no config, lease held elsewhere)
   * reports zero reclaim instead of a stale value.
   */
  private var recovery = RecoveryResult(processingReturned = 0, abandonedCycleId = null)

  /**
   * Runs the attempt to a terminal outcome. Never throws: every failure inside the pipeline is
   * classified into `failed` (with rows reverted). [onState] is invoked on every journal
   * transition so the watchdog (outside this class) always knows the state a parked attempt is
   * sitting in.
   */
  fun run(triggerSource: String, cycleId: String, onState: (String) -> Unit): CycleOutcome {
    this.cycleId = cycleId
    this.onState = onState

    return try {
      runCycle(triggerSource)
    } catch (error: LeaseLostException) {
      // Fence contract: a guarded write proved the lease was reclaimed by a later attempt. Stop
      // writing (nothing further here touches state), record the abandon, and end the attempt.
      // Drop the adopted pair too: a stale pair here would let a later guarded write on this
      // instance silently pass its requireOwned() gate.
      leaseFence = null
      transition("abandoned", "cycle lease lost: ${error.message}")
      outcome("abandoned", lastState, 0, 0, "LeaseLost")
    } catch (error: Throwable) {
      // Unexpected failure after the claim: revert the batch to `pending` (never dead-letter —
      // only the bridge's own 4xx classifies content as rejected), name the failure, terminal.
      revertClaimedRows(deadLetter = false)
      transition("failed", error.message ?: error.javaClass.simpleName)
      outcome("failed", lastState, 0, 0, error.javaClass.simpleName)
    } finally {
      lease.release()
    }
  }

  /**
   * Answers the fence pair this attempt writes under, throwing [LeaseLostException] when no
   * lease is held -- callers upstream of the claim never reach a guarded write.
   */
  private fun requireOwned(): LeaseFence =
    leaseFence ?: throw LeaseLostException("attempt holds no cycle lease")

  /** Appends one intent-before-effect journal transition and advances the tracked state. */
  private fun transition(toState: String, reason: String?) {
    journal.append(cycleId, lastState, toState, reason, System.currentTimeMillis())
    lastState = toState
    onState(toState)
  }

  private fun runCycle(triggerSource: String): CycleOutcome {
    // Intent before effect: the config read below is the first step the journal names.
    transition("checked", null)

    val config = readBridgeConfig(appDb)
    if (config == null || !hasCompleteBridgeConnection(config)) {
      transition("not_applicable", "bridge config missing or incomplete")
      return CycleOutcome("not_applicable", lastState, 0, 0, null)
    }
    // Non-null by `hasCompleteBridgeConnection`; local aliases keep the smart-cast.
    val deviceId = config.deviceId ?: ""
    val ip = config.ip ?: ""
    val port = config.port ?: ""
    val token = config.token ?: ""

    if (!lease.claim(cycleId)) {
      transition("not_applicable", "sync cycle lease held elsewhere")
      return CycleOutcome("not_applicable", lastState, 0, 0, null)
    }
    // Adopt the pair the claim just verified: SyncCycleLease reads the row back naming our
    // owner and the attempt's fence (its cycle id) inside claim(), so this is a copy of the
    // authoritative value, never a re-derivation. Without it requireOwned() would throw on the
    // success path itself.
    leaseFence = lease.leaseFence
    val fence = requireOwned()

    // Recovery sweep (T4): with the lease held, every stale claim in the journal or in
    // `processing` is an orphan from an attempt that died — reclaim it BEFORE reading the
    // backlog. A sweep error never fails the attempt: it logs, reports, and continues -- but a
    // sweep that finds the lease already lost must not write on (fence contract).
    recovery = SyncEngineRecovery(appDb, journal).sweep(cycleId, fence)
    if (recovery.leaseLost) {
      transition("abandoned", "cycle lease lost before the backlog read")
      return outcome("abandoned", lastState, 0, 0, "LeaseLost")
    }

    // Diagnostics drain (C2): once the fence is held and before the backlog read, so BOTH the
    // claimed path and the pull-only path deliver stored envelopes first. Deliberately placed here
    // and not around the reconcile: it is not a journaled step (the attempt's states stay exactly
    // as they were), it never throws (the courier swallows by contract), and its tally is not part
    // of the outcome -- instrumentation delivery must never change whether a cycle succeeded.
    diagnostics.drain(
      isSyncTelemetryEnabled = config.isSyncTelemetryEnabled,
      connection = SyncDiagnosticsConnection(ip = ip, port = port, token = token),
    )

    val backlog = readBacklog()
    val backlogReadCount = backlog.size

    if (backlog.isEmpty()) {
      // Nothing to claim, but the attempt must still PULL: the JS no-op attempt always issues
      // the reconcile request, so remote changes reach the device even with nothing to push.
      return runPullOnlyAttempt(config, deviceId, ip, port, token, triggerSource, backlogReadCount)
    }

    // Intent before effect, THEN the claim in one transaction (step 5).
    transition("claimed", null)
    inImmediateTransaction(appDb) {
      claimRows(backlog)
    }
    claimedRows = backlog

    val lastChangelogId = getLastChangelogId(config.lastChangelogId)
    val tokensByAnimeId = readAnimeBridgeTokens(backlog.map { it.animeId })
    val requestBody = ReconcileRequestBody.build(
      deviceId = deviceId,
      lastChangelogId = lastChangelogId,
      rows = backlog,
      tokensByAnimeId = tokensByAnimeId,
      cycleId = cycleId,
      triggerSource = triggerSource,
    )

    // Intent before effect, THEN the request (step 6).
    transition("sent", null)
    val response = try {
      SyncEngineHttp.postJson(
        url = "http://$ip:$port/api/sync/reconcile",
        token = token,
        body = requestBody.toString(),
        timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS,
      )
    } catch (error: Throwable) {
      // Transport failure: retryable, never dead-lettered (step 7's sibling rule).
      revertClaimedRows(deadLetter = false)
      transition("failed", error.message ?: error.javaClass.simpleName)
      return outcome("failed", lastState, 0, backlogReadCount, error.javaClass.simpleName)
    }

    if (response.code !in 200..299) {
      // The bridge rejected this exchange: a 4xx means the batch's CONTENT was rejected, so
      // those rows go to `dead_letter`; anything else goes back to `pending` for retry.
      revertClaimedRows(deadLetter = response.code in 400..499)
      transition("failed", "bridge responded ${response.code}")
      return outcome("failed", lastState, 0, backlogReadCount, "ReconcileHttpError")
    }

    val parsed = try {
      ReconcileResponseParser.parse(response.body)
    } catch (error: ReconcileParseException) {
      // Parse failure is retryable: rows back to `pending`, never dead-lettered (step 7).
      revertClaimedRows(deadLetter = false)
      transition("failed", error.message ?: "invalid reconcile response")
      return outcome("failed", lastState, 0, backlogReadCount, "ReconcileParseException")
    }

    // Intent before effect, THEN every response write in ONE transaction (step 8). The fence
    // check is the FIRST statement inside the transaction: the write lock pins the lease for the
    // whole transaction (a reclaim is itself a write), so the cursor advance and status updates
    // below cannot interleave with a reclaim. The staging inserts and the `animes` OCC token
    // writes stay deliberately unfenced: staging is append-only staging of bridge responses
    // (re-application under the merge boundary is idempotent), and the token is a keyed advisory
    // OCC value whose stale write self-heals at the bridge as a conflict on the next operation.
    transition("applied", null)
    val syncedCount = inImmediateTransaction(appDb) {
      requireLeaseOwnership(appDb, requireOwned())
      ensureStagingTable()
      responseApplier.apply(config.id, parsed, backlog, lastChangelogId)
    }

    // Prune failure must not fail the attempt (step 9), but lease loss during the prune must
    // abandon it: the pruner re-verifies ownership as the FIRST statement inside its own
    // BEGIN IMMEDIATE (see OperationLogPruner.pruneSafely), closing the window a
    // pre-transaction check leaves between the check and the prune's write lock.
    OperationLogPruner.pruneSafely(appDb, requireOwned())

    transition("closed", null)
    return outcome("closed", lastState, syncedCount, backlogReadCount, null)
  }

  /**
   * Runs the attempt to a terminal outcome for an EMPTY backlog: nothing to claim or send,
   * but the reconcile request is still issued — the JS cycle's no-op attempt always runs
   * `syncPendingOperations`, so pulled `bridge_changes` reach the device even when there is
   * nothing to push. The request is the claimed path's shape with an empty
   * `pending_operations` array, and the response is parsed and staged by the exact same
   * pipeline (`ReconcileResponseParser` + [SyncEngineResponseApplier]).
   *
   * Journal sequence mirrors the claimed path minus `claimed` (no rows exist to claim):
   * `sent` before the POST, `applied` before the one response-write transaction, `closed`
   * after pruning — or `failed` with the claimed path's error taxonomy (`ReconcileHttpError`,
   * `ReconcileParseException`, or the transport error's class name). No rows were ever
   * claimed, so the failure paths skip the batch revert ([revertClaimedRows] no-ops on an
   * empty batch anyway).
   */
  private fun runPullOnlyAttempt(
    config: BridgeConfigRow,
    deviceId: String,
    ip: String,
    port: String,
    token: String,
    triggerSource: String,
    backlogReadCount: Int,
  ): CycleOutcome {
    val lastChangelogId = getLastChangelogId(config.lastChangelogId)
    val requestBody = ReconcileRequestBody.build(
      deviceId = deviceId,
      lastChangelogId = lastChangelogId,
      rows = emptyList(),
      tokensByAnimeId = emptyMap(),
      cycleId = cycleId,
      triggerSource = triggerSource,
    )

    // Intent before effect, THEN the pull request (step 6; no claim step without rows).
    transition("sent", null)
    val response = try {
      SyncEngineHttp.postJson(
        url = "http://$ip:$port/api/sync/reconcile",
        token = token,
        body = requestBody.toString(),
        timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS,
      )
    } catch (error: Throwable) {
      // Transport failure: retryable, never dead-lettered (step 7's sibling rule).
      transition("failed", error.message ?: error.javaClass.simpleName)
      return outcome("failed", lastState, 0, backlogReadCount, error.javaClass.simpleName)
    }

    if (response.code !in 200..299) {
      // The bridge rejected this exchange; nothing was claimed, so nothing to revert.
      transition("failed", "bridge responded ${response.code}")
      return outcome("failed", lastState, 0, backlogReadCount, "ReconcileHttpError")
    }

    val parsed = try {
      ReconcileResponseParser.parse(response.body)
    } catch (error: ReconcileParseException) {
      // Parse failure is retryable, never dead-lettered (step 7).
      transition("failed", error.message ?: "invalid reconcile response")
      return outcome("failed", lastState, 0, backlogReadCount, "ReconcileParseException")
    }

    // Intent before effect, THEN every response write in ONE transaction (step 8): the staging
    // inserts and the cursor advance run even with zero claimed rows; the confirmation and
    // status passes no-op over the empty backlog. Fence check first -- see the claimed path.
    transition("applied", null)
    val syncedCount = inImmediateTransaction(appDb) {
      requireLeaseOwnership(appDb, requireOwned())
      ensureStagingTable()
      responseApplier.apply(config.id, parsed, emptyList(), lastChangelogId)
    }

    // Prune failure must not fail the attempt (step 9); fence check inside the prune's own
    // transaction -- see the claimed path and OperationLogPruner.pruneSafely.
    OperationLogPruner.pruneSafely(appDb, requireOwned())

    transition("closed", null)
    return outcome("closed", lastState, syncedCount, backlogReadCount, null)
  }

  /**
   * Builds the attempt's terminal outcome with this attempt's recovery sweep result attached,
   * so the JS seam can observe what the sweep reclaimed without a second bridge call.
   */
  private fun outcome(
    outcome: String,
    stage: String,
    syncedCount: Int,
    backlogReadCount: Int,
    errorName: String?,
  ): CycleOutcome = CycleOutcome(
    outcome = outcome,
    stage = stage,
    syncedCount = syncedCount,
    backlogReadCount = backlogReadCount,
    errorName = errorName,
    recoveredProcessingCount = recovery.processingReturned,
    recoveredAbandonedCycleId = recovery.abandonedCycleId,
  )

  /**
   * Reverts the claimed batch on failure: to `dead_letter` when the bridge's 4xx response said
   * the batch's content was rejected, to `pending` for every retryable failure. No-ops for an
   * empty batch. Mirrors `revertPendingOperationsOnFailure`.
   */
  private fun revertClaimedRows(deadLetter: Boolean) {
    val rows = claimedRows
    if (rows.isEmpty()) return
    try {
      inImmediateTransaction(appDb) {
        updateOperationStatus(
          rows.map { it.id },
          if (deadLetter) "dead_letter" else "pending",
        )
      }
    } catch (error: Throwable) {
      // A revert failure must not replace the attempt's own terminal outcome; the lease's
      // expiry and the recovery sweep are the designed backstops.
      Log.w(TAG, "failed to revert claimed rows", error)
    }
  }

  /**
   * Claims the singleton lease through [SyncCycleLease]; the conditional UPSERT there is the
   * exact port of `claimSyncCycleLock`.
   */
  private fun claimLease(): Boolean = lease.claim(cycleId)

  /** Reads the deduped backlog verbatim from `buildDedupedBacklogQuery` (step 4). */
  private fun readBacklog(): List<BacklogRow> {
    val rows = mutableListOf<BacklogRow>()
    appDb.rawQuery(BACKLOG_QUERY, arrayOf("pending", "processing", BACKLOG_BATCH_LIMIT.toString()))
      .use { cursor ->
        while (cursor.moveToNext()) {
          rows.add(
            BacklogRow(
              id = cursor.getLong(0),
              animeId = cursor.getString(1),
              operation = cursor.getString(2),
              payload = cursor.getString(3),
              status = cursor.getString(4),
              createdAt = cursor.getLong(5),
              conflictAttemptCount = cursor.getLong(6),
            ),
          )
        }
      }
    return rows
  }

  /** Marks the batch `processing` inside the caller's already-open transaction (step 5). */
  private fun claimRows(rows: List<BacklogRow>) {
    updateOperationStatus(rows.map { it.id }, "processing")
  }

  /**
   * Reads the stored OCC token per anime, mirroring `readAnimeBridgeTokens`: an absent map
   * entry means the row was not found; a present `null` entry means the row exists but no
   * token is known yet — both read as "no known token" (`base` omitted) at the call site.
   */
  private fun readAnimeBridgeTokens(animeIds: List<String>): Map<String, Long?> {
    if (animeIds.isEmpty()) return emptyMap()
    val tokens = mutableMapOf<String, Long?>()
    val placeholders = animeIds.joinToString(", ") { "?" }
    appDb.rawQuery(
      "SELECT _id, bridge_modified_at FROM animes WHERE _id IN ($placeholders)",
      animeIds.toTypedArray(),
    ).use { cursor ->
      while (cursor.moveToNext()) {
        tokens[cursor.getString(0)] = if (cursor.isNull(1)) null else cursor.getLong(1)
      }
    }
    return tokens
  }

  /**
   * Bulk status update over `operation_log`, FENCED: the statement only affects rows while the
   * lease still names this attempt's owner and fence, so a reclaimed lease cannot clobber the
   * new owner's claims (and a zero-row result on a non-empty batch is ownership loss, never
   * silence). Covers every `operation_log` status transition of the attempt: the claim, the
   * failure revert, and the response applier's confirmation/dead-letter/pending passes. The
   * response applier receives this as a bound reference, so the claimed path and the pull-only
   * path share one writer implementation.
   */
  private fun updateOperationStatus(ids: List<Long>, status: String) {
    val fence = requireOwned()
    val placeholders = ids.joinToString(", ") { "?" }
    val affected = appDb.compileStatement(
      "UPDATE operation_log SET status = ? WHERE id IN ($placeholders) AND $LEASE_OWNERSHIP_GUARD_SQL",
    ).run {
      bindString(1, status)
      ids.forEachIndexed { index, id -> bindLong(index + 2, id) }
      bindString(ids.size + 2, fence.owner)
      bindString(ids.size + 3, fence.fence)
      executeUpdateDelete()
    }
    if (affected == 0 && ids.isNotEmpty()) {
      // Fence contract: zero rows on a non-empty batch means the lease row no longer names us
      // (or the batch vanished, which only a reclaimed owner cannot distinguish). Either way the
      // attempt must not write on: the caller's transaction rolls back and the attempt abandons.
      throw LeaseLostException("status update to '$status' affected 0 rows")
    }
  }

  /**
   * Creates the staging table when missing, byte-identical to the app's repair DDL, so the
   * staging inserts below cannot fail on a store that has not had its first foreground open.
   */
  private fun ensureStagingTable() {
    appDb.execSQL(PENDING_REMOTE_CHANGES_TABLE_SQL)
  }

  /**
   * Reads the persisted changelog cursor with `getLastChangelogId`'s validation: only a finite
   * value within [0, MAX_REASONABLE_CHANGELOG_ID] is trusted; anything else reads as 0.
   */
  private fun getLastChangelogId(raw: Long?): Long {
    return if (raw != null && raw >= 0 && raw <= MAX_REASONABLE_CHANGELOG_ID) raw else 0
  }
}
