package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.util.Log
import java.util.UUID

private const val TAG = "SyncEngineCycle"

/** The deduped backlog batch size; mirrors `RECONCILE_BACKLOG_BATCH_LIMIT`. */
private const val BACKLOG_BATCH_LIMIT = 200

/** Request budget for the bridge POST; mirrors `BRIDGE_REQUEST_TIMEOUT_MS`. */
private const val BRIDGE_REQUEST_TIMEOUT_MS = 10_000

/** Cursor sanity bound, mirroring `MAX_REASONABLE_CHANGELOG_ID`. */
private const val MAX_REASONABLE_CHANGELOG_ID = 1_000_000_000_000L

/** One terminal attempt result, handed to the caller of [SyncEngineRunner.runOnce]. */
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
)

/**
 * One native sync attempt, ported step by step from the JS cycle
 * (`headless-sync-cycle.helpers.ts` + `reconcile.helpers.ts` in `staged` mode) with the exact
 * semantics each step's TypeScript reference defines. Differences are deliberate and named:
 * - the no-config case returns `not_applicable` instead of throwing (a background attempt is a
 *   probe, not a user-facing failure);
 * - the conflict-exhaustion policy (attempt caps and the token re-base) is DEFERRED, not
 *   silently skipped: conflicts fall back to the generic "reset to pending" retry;
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
  /** Epoch-ms clock for the claim time and the chain budget; tests advance it. */
  private val clock: () -> Long = System::currentTimeMillis,
  /** This attempt's request ids; `null` sends every bridge request without one. */
  private val requestIds: RequestIdSequence? = null,
) {
  private val lease = SyncCycleLease(appDb)

  /**
   * Shared response-apply step: every round, the pull-only first round included, stages the
   * parsed response through it.
   */
  private val heldRows = HeldRowWriter(appDb, { requireOwned() }, { claim })
  private val missingTokens = MissingTokenResolver(appDb, heldRows) { requireOwned() }
  private val ratings = SeasonRatingSender(appDb, heldRows, { requireOwned() }, { claim }, clock) { rows ->
    attemptClaimedIds += rows.map { it.id }
  }
  private val responseApplier = SyncEngineResponseApplier(
    appDb,
    heldRows::updateOperationStatus,
    heldRows::writeConflictOutcome,
    heldRows::heldOperationIds,
  )
  private var cycleId: String = ""
  private var lastState: String = "idle"
  private var claimedRows: List<BacklogRow> = emptyList()

  /**
   * Every row this attempt claimed: the backlog and each successor a round or a rating claimed
   * (ADR 009 R-13, R-14). An unexpected failure releases all of them still held, so no row this
   * attempt claimed stays `processing` when it ends -- [claimedRows] alone names only the edits
   * of the round in flight, not its ratings or earlier successors.
   */
  private val attemptClaimedIds = linkedSetOf<Long>()
  private var onState: (String) -> Unit = {}

  /**
   * The per-key outbox claim this attempt took (ADR 009 R-13); every status write after the
   * claim is compare-and-set on it. Until the backlog is claimed it is [UNCLAIMED], which no row
   * carries, so a guarded write before the claim touches nothing.
   */
  private var claim: OutboxClaim = UNCLAIMED

  /**
   * The owner/fence pair this attempt writes under, set by a successful claim and cleared when
   * a fenced write proves the lease was reclaimed. Every destructive or monotonic write below is
   * guarded by it -- see [requireOwned] and [HeldRowWriter].
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
      // Unexpected failure after the claim: release every row this attempt still holds to
      // `pending` (never dead-letter — only the bridge's own 4xx classifies content as rejected),
      // name the failure, terminal.
      revertClaimedRows(deadLetter = false, ids = attemptClaimedIds.toList())
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

  /** The id for this attempt's next bridge request, or `null` when it carries none. */
  private fun nextRequestId(): String? = requestIds?.next()

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
    // `!!`, not `?: ""` (T3, sync-core-test-assurance): `hasCompleteBridgeConnection` above
    // already guarantees all four fields non-null/non-blank, so `?: ""` was dead code the
    // compiler just can't smart-cast across a function-call boundary; `!!` proves the same
    // invariant and fails loudly instead of silently degrading to "" if it were ever violated.
    val deviceId = config.deviceId!!
    val ip = config.ip!!
    val port = config.port!!
    val token = config.token!!

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
      nextRequestId = ::nextRequestId,
    )

    // Read and claim in ONE transaction (ADR 009 R-13): a key with a live claim, ours or the JS
    // runtime's, is skipped, and the claim cannot be raced between the read and the write. The
    // claim time is taken inside the transaction, so a wait for the write lock never shortens it.
    // The claim reads its rows back inside the same transaction: that read-back is this single
    // send's re-check (R-13), immediately before the request.
    val (cycleClaim, backlog) = inImmediateTransaction(appDb) {
      requireLeaseOwnership(appDb, fence)
      val taken = OutboxClaim(NATIVE_OUTBOX_CLAIM_OWNER, clock())
      taken to claimOperationLogBacklog(appDb, taken, BACKLOG_BATCH_LIMIT)
    }
    claim = cycleClaim
    attemptClaimedIds += backlog.map { it.id }

    // The first round always goes out, even with nothing claimed: it is also this attempt's pull,
    // exactly like the JS no-op attempt, so remote changes reach the device with nothing to push.
    if (backlog.isNotEmpty()) transition("claimed", null)
    // The chain (ADR 009 R-14): each round sends the held rows, waits for their confirmation and
    // tokens, and the transaction that applies the response claims the next row of every key it
    // confirmed. A rejected key claims nothing; a failed round ends the chain; past the budget no
    // successor is claimed. Earlier rounds stay committed whatever a later round does.
    val target = RoundTarget(deviceId, ip, port, token, triggerSource, config.id, cycleClaim.claimedAt + OUTBOX_CHAIN_BUDGET_MS)
    var round = backlog
    var lastChangelogId = getLastChangelogId(config.lastChangelogId)
    var syncedCount = 0
    var backlogReadCount = 0
    var firstRound = true
    do {
      backlogReadCount += round.size
      // A key's rows go out in order whatever their endpoint (L28): the round holds at most one
      // row per anime, so its anime edits share one reconcile and its ratings follow, one each.
      val (seasonRatings, edits) = round.partition { it.operation == SEASON_RATING_OPERATION }
      val result = if (firstRound || edits.isNotEmpty()) {
        reconcileRound(target, edits, lastChangelogId, includeTelemetry = firstRound)
      } else {
        RoundResult.Applied(0, emptyList(), lastChangelogId)
      }
      firstRound = false
      if (result is RoundResult.Failed) {
        // The reconcile failed first: this round's ratings are released unsent.
        releaseRows(seasonRatings)
        return outcome("failed", lastState, syncedCount + result.confirmedCount, backlogReadCount, result.errorName)
      }
      // A settled round is applied: `settleRejection` never answers a rejection.
      val applied = result as RoundResult.Applied
      attemptClaimedIds += applied.successors.map { it.id }
      claimedRows = seasonRatings
      val rated = ratings.send(seasonRatings, target.chainDeadline) { body ->
        SyncEngineHttp.postJson("http://${target.ip}:${target.port}$SEASON_RATING_PATH", target.token, body, BRIDGE_REQUEST_TIMEOUT_MS, nextRequestId())
      }
      syncedCount += applied.confirmedCount + rated.confirmedCount
      lastChangelogId = applied.cursor
      round = applied.successors + rated.successors
    } while (round.isNotEmpty())
    claimedRows = emptyList()

    // Prune failure must not fail the attempt (step 9), but lease loss during the prune must
    // abandon it: the pruner re-verifies ownership as the FIRST statement inside its own
    // BEGIN IMMEDIATE (see OperationLogPruner.pruneSafely), closing the window a
    // pre-transaction check leaves between the check and the prune's write lock.
    OperationLogPruner.pruneSafely(appDb, requireOwned())

    transition("closed", null)
    return outcome("closed", lastState, syncedCount, backlogReadCount, null)
  }

  /** What every round of one attempt sends to, and under which chain budget. */
  private data class RoundTarget(
    val deviceId: String,
    val ip: String,
    val port: String,
    val token: String,
    val triggerSource: String,
    val bridgeConfigId: Long,
    val chainDeadline: Long,
  )

  /**
   * Sends ONE reconcile round for [round] and applies its response (steps 6-8). Every failure
   * gives the round's rows their fate and journals `failed`, except a message rejection (a 4xx
   * other than 401, ADR 009 R-5), which is returned untouched for [settleRejection]. An empty
   * round is the pull-only exchange: nothing to claim, revert or confirm.
   */
  private fun sendRound(target: RoundTarget, round: List<BacklogRow>, cursor: Long, includeTelemetry: Boolean): RoundResult {
    claimedRows = round
    val tokensByAnimeId = readAnimeBridgeTokens(appDb, round.map { it.animeId }).toMutableMap()
    // Never without a base (ADR 009 R-3): an anime with no stored token is fetched first.
    val sendable = missingTokens.resolve(round, tokensByAnimeId) { animeId ->
      SyncEngineHttp.get("http://${target.ip}:${target.port}/api/animes/${Uri.encode(animeId)}", target.token, BRIDGE_REQUEST_TIMEOUT_MS, nextRequestId())
    }
    claimedRows = sendable
    val requestBody = ReconcileRequestBody.build(
      deviceId = target.deviceId,
      lastChangelogId = cursor,
      rows = sendable,
      tokensByAnimeId = tokensByAnimeId,
      cycleId = cycleId,
      triggerSource = target.triggerSource,
      includeTelemetry = includeTelemetry,
    )

    // Intent before effect, THEN the request (step 6).
    transition("sent", null)
    val response = try {
      SyncEngineHttp.postJson(
        url = "http://${target.ip}:${target.port}/api/sync/reconcile",
        token = target.token,
        body = requestBody.toString(),
        timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS,
        requestId = nextRequestId(),
      )
    } catch (error: Throwable) {
      // Transport failure: retryable, never dead-lettered (step 7's sibling rule).
      return fail(deadLetter = false, error.message ?: error.javaClass.simpleName, error.javaClass.simpleName)
    }

    if (response.code !in 200..299) {
      val rejected = response.code in 400..499
      if (rejected && response.code != RECONCILE_UNAUTHORIZED_STATUS) return RoundResult.Rejected(response.code, sendable)
      // A 401 rejects the pairing: terminal for the whole round. Anything else is retryable.
      return fail(deadLetter = rejected, "bridge responded ${response.code}", "ReconcileHttpError")
    }

    val parsed = try {
      ReconcileResponseParser.parse(response.body)
    } catch (error: ReconcileParseException) {
      // Parse failure is retryable: rows back to `pending`, never dead-lettered (step 7).
      // `error.message` bare: ReconcileParseException requires a non-null message.
      return fail(deadLetter = false, error.message, "ReconcileParseException")
    }

    // Intent before effect, THEN every response write in ONE transaction (step 8). The fence
    // check is the FIRST statement inside the transaction: the write lock pins the lease for the
    // whole transaction (a reclaim is itself a write), so the cursor advance and status updates
    // below cannot interleave with a reclaim. Staging stays unfenced (append-only, idempotent
    // under the merge boundary); token writes are limited to keys this claim still holds.
    transition("applied", null)
    val (confirmedIds, successors) = inImmediateTransaction(appDb) {
      requireLeaseOwnership(appDb, requireOwned())
      ensureStagingTable()
      val confirmed = responseApplier.apply(target.bridgeConfigId, parsed, sendable, cursor, tokensByAnimeId)
      val confirmedSet = confirmed.toSet()
      val next = if (clock() >= target.chainDeadline) {
        emptyList()
      } else {
        claimChainSuccessors(appDb, claim, sendable.filter { it.id in confirmedSet }.map { it.animeId })
      }
      confirmed to next
    }
    return RoundResult.Applied(confirmedIds.size, successors, maxOf(cursor, parsed.lastChangelogId ?: cursor))
  }

  /** Sends one reconcile for [edits] and settles a message rejection, if any. */
  private fun reconcileRound(target: RoundTarget, edits: List<BacklogRow>, cursor: Long, includeTelemetry: Boolean): RoundResult {
    val sent = sendRound(target, edits, cursor, includeTelemetry)
    return if (sent is RoundResult.Rejected) settleRejection(target, sent, cursor) else sent
  }

  /** Releases [rows] to `pending`, compare-and-set on the claim; never throws. */
  private fun releaseRows(rows: List<BacklogRow>) {
    claimedRows = rows
    revertClaimedRows(deadLetter = false)
  }

  /** Gives the round's rows their failure fate and journals the failure that ends the attempt. */
  private fun fail(deadLetter: Boolean, reason: String?, errorName: String): RoundResult.Failed {
    revertClaimedRows(deadLetter)
    transition("failed", reason)
    return RoundResult.Failed(errorName)
  }

  /**
   * Settles a message rejection (ADR 009 R-5): a round of several messages is re-sent one message
   * per request ([isolateMessages]), so only the one that caused it is dead-lettered; a lone
   * message is dead-lettered and ends the attempt, as nothing got through.
   */
  private fun settleRejection(target: RoundTarget, rejection: RoundResult.Rejected, cursor: Long): RoundResult {
    if (rejection.sent.size <= 1) return fail(deadLetter = true, "bridge responded ${rejection.code}", "ReconcileHttpError")

    return isolateMessages(rejection, cursor, object : MessageIsolationPort {
      override fun isHeld(row: BacklogRow) = heldRows.heldOperationIds(listOf(row.id)).isNotEmpty()

      override fun send(row: BacklogRow, cursor: Long) = sendRound(target, listOf(row), cursor, includeTelemetry = false)

      override fun deadLetter(row: BacklogRow) = inImmediateTransaction(appDb) {
        heldRows.updateOperationStatus(listOf(row.id), "dead_letter")
      }

      override fun release(rows: List<BacklogRow>) = releaseRows(rows)

      override fun noneDelivered(rejection: RoundResult.Rejected): RoundResult.Failed {
        // Every isolated message is already dead-lettered: nothing is left to revert.
        claimedRows = emptyList()
        return fail(deadLetter = true, "bridge responded ${rejection.code}", "ReconcileHttpError")
      }
    })
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
   * empty batch. Mirrors `revertPendingOperationsOnFailure`. The writes are compare-and-set on
   * the claim, so a row already settled -- or taken over by the JS runtime -- is never touched.
   */
  private fun revertClaimedRows(deadLetter: Boolean, ids: List<Long> = claimedRows.map { it.id }) {
    if (ids.isEmpty()) return
    try {
      inImmediateTransaction(appDb) {
        heldRows.updateOperationStatus(ids, if (deadLetter) "dead_letter" else "pending")
      }
    } catch (error: Throwable) {
      // A revert failure must not replace the attempt's own terminal outcome; the claim's 60 s
      // expiry, the lease's expiry and the recovery sweep are the designed backstops.
      Log.w(TAG, "failed to revert claimed rows", error)
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
