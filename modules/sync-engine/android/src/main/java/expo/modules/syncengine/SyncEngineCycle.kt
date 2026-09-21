package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
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

private const val UNSUPPORTED_OPERATION_REASON = "unsupported_operation"

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
 * - the conflict-exhaustion policy (attempt caps and the token re-base), the diagnostics flush
 *   (`POST /api/sync/diagnostics`) and the full `client_telemetry` envelope are DEFERRED, not
 *   silently skipped: conflicts fall back to the generic "reset to pending" retry.
 *
 * Journal discipline (docs/mobile-sync-architecture.md 6.2/6.3): every transition row is
 * appended BEFORE the effect it names, so an attempt parked inside a native call reports the
 * state it parked in. `not_applicable` is journaled as a transition INTO that outcome state.
 */
class SyncEngineCycle(
  private val appDb: SQLiteDatabase,
  private val journal: SyncEngineJournal,
) {
  private val lease = SyncCycleLease(appDb)
  private var cycleId: String = ""
  private var lastState: String = "idle"
  private var claimedRows: List<BacklogRow> = emptyList()
  private var onState: (String) -> Unit = {}

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

  /** Appends one intent-before-effect journal transition and advances the tracked state. */
  private fun transition(toState: String, reason: String?) {
    journal.append(cycleId, lastState, toState, reason, System.currentTimeMillis())
    lastState = toState
    onState(toState)
  }

  private fun runCycle(triggerSource: String): CycleOutcome {
    // Intent before effect: the config read below is the first step the journal names.
    transition("checked", null)

    val config = readBridgeConfig()
    if (config == null || !hasCompleteBridgeConnection(config)) {
      transition("not_applicable", "bridge config missing or incomplete")
      return CycleOutcome("not_applicable", lastState, 0, 0, null)
    }
    // Non-null by `hasCompleteBridgeConnection`; local aliases keep the smart-cast.
    val deviceId = config.deviceId ?: ""
    val ip = config.ip ?: ""
    val port = config.port ?: ""
    val token = config.token ?: ""

    if (!lease.claim()) {
      transition("not_applicable", "sync cycle lease held elsewhere")
      return CycleOutcome("not_applicable", lastState, 0, 0, null)
    }

    // Recovery sweep (T4): with the lease held, every stale claim in the journal or in
    // `processing` is an orphan from an attempt that died — reclaim it BEFORE reading the
    // backlog. A sweep error never fails the attempt: it logs, reports, and continues.
    recovery = SyncEngineRecovery(appDb, journal).sweep(cycleId)

    val backlog = readBacklog()
    val backlogReadCount = backlog.size

    if (backlog.isEmpty()) {
      // Nothing to claim or send; prune and close, mirroring the JS no-op attempt.
      OperationLogPruner.pruneSafely(appDb)
      transition("closed", null)
      return outcome("closed", lastState, 0, backlogReadCount, null)
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

    // Intent before effect, THEN every response write in ONE transaction (step 8).
    transition("applied", null)
    val syncedCount = inImmediateTransaction(appDb) {
      ensureStagingTable()
      applyResponseWrites(config.id, parsed, backlog, lastChangelogId)
    }

    // Prune failure must not fail the attempt (step 9).
    OperationLogPruner.pruneSafely(appDb)

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

  /** Reads the single `bridge_config` row; `null` when absent, or on a not-yet-migrated store. */
  private fun readBridgeConfig(): BridgeConfigRow? {
    return try {
      appDb.rawQuery(
        "SELECT id, device_id, ip, port, token, last_changelog_id FROM bridge_config " +
          "ORDER BY id DESC LIMIT 1",
        null,
      ).use { cursor ->
        if (!cursor.moveToFirst()) {
          null
        } else {
          BridgeConfigRow(
            id = cursor.getLong(0),
            deviceId = cursor.getString(1),
            ip = cursor.getString(2),
            port = cursor.getString(3),
            token = cursor.getString(4),
            lastChangelogId = if (cursor.isNull(5)) null else cursor.getLong(5),
          )
        }
      }
    } catch (error: SQLiteException) {
      // A fresh install has no schema until the foreground's first open; mirror the JS
      // SchemaNotReadyError -> no-op handling with `not_applicable`.
      Log.w(TAG, "bridge_config unreadable (schema not ready?)", error)
      null
    }
  }

  private fun hasCompleteBridgeConnection(config: BridgeConfigRow): Boolean {
    return !config.deviceId.isNullOrBlank() &&
      !config.ip.isNullOrBlank() &&
      !config.port.isNullOrBlank() &&
      !config.token.isNullOrBlank()
  }

  /**
   * Claims the singleton lease through [SyncCycleLease]; the conditional UPSERT there is the
   * exact port of `claimSyncCycleLock`.
   */
  private fun claimLease(): Boolean = lease.claim()

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
   * Applies every write the response produced, all inside the ONE transaction the caller
   * opened (step 8), in the exact order the JS `applyReconcileResponseWrites` uses: staging
   * first (it may be what creates the row), then the token writes that depend on row
   * existence, then the status updates, then the cursor advance.
   *
   * Token source is `applied_operations` ONLY — never `bridge_changes[].snapshot.modified_at`,
   * which the bridge hardcodes to 0. PRESENCE, not truthiness: an absent key contributes
   * nothing; `0` is a real token. When one anime appears more than once, the LAST entry wins.
   */
  private fun applyResponseWrites(
    configId: Long,
    parsed: ParsedReconcileResponse,
    backlog: List<BacklogRow>,
    lastChangelogId: Long,
  ): Int {
    val normalizedChanges = parsed.bridgeChanges.map { WireAnimeMapper.normalize(it) }
    val createdAt = System.currentTimeMillis()
    for (change in normalizedChanges) {
      appDb.compileStatement(
        "INSERT INTO pending_remote_changes " +
          "(record_id, change_type, changed_fields, snapshot, timestamp, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      ).apply {
        bindString(1, change.recordId)
        bindString(2, change.changeType)
        bindString(3, change.changedFieldsJson)
        if (change.snapshotJson != null) bindString(4, change.snapshotJson) else bindNull(4)
        bindLong(5, change.timestamp)
        bindLong(6, createdAt)
        executeInsert()
      }
    }

    val tokenByAnimeId = LinkedHashMap<String, Long>()
    for (entry in parsed.appliedOperations) {
      if (entry.applied && entry.modifiedAt != null) {
        tokenByAnimeId[entry.animeId] = entry.modifiedAt
      }
    }
    for ((animeId, bridgeModifiedAt) in tokenByAnimeId) {
      appDb.compileStatement(
        "UPDATE animes SET bridge_modified_at = ? WHERE _id = ?",
      ).apply {
        bindLong(1, bridgeModifiedAt)
        bindString(2, animeId)
        executeUpdateDelete()
      }
    }

    val confirmedIds = ReconcileConfirmation.getConfirmedOperationIds(backlog, parsed)
    val confirmedIdSet = confirmedIds.toSet()

    // Conflict-exhaustion policy is DEFERRED: only `unsupported_operation` reaches
    // `dead_letter`; every other unconfirmed operation resets to `pending`.
    val deadLetterIds = mutableListOf<Long>()
    val pendingIds = mutableListOf<Long>()
    for (row in backlog) {
      if (row.id in confirmedIdSet) continue
      val rejected = parsed.appliedOperations.firstOrNull {
        it.animeId == row.animeId && it.operation == row.operation && !it.applied
      }
      if (rejected?.reason == UNSUPPORTED_OPERATION_REASON) {
        deadLetterIds.add(row.id)
      } else {
        pendingIds.add(row.id)
      }
    }

    if (deadLetterIds.isNotEmpty()) updateOperationStatus(deadLetterIds, "dead_letter")
    if (confirmedIds.isNotEmpty()) updateOperationStatus(confirmedIds, "synced")
    if (pendingIds.isNotEmpty()) updateOperationStatus(pendingIds, "pending")

    val nextLastChangelogId = parsed.lastChangelogId ?: lastChangelogId
    if (nextLastChangelogId > lastChangelogId) {
      appDb.compileStatement(
        "UPDATE bridge_config SET last_changelog_id = ? WHERE id = ?",
      ).apply {
        bindLong(1, nextLastChangelogId)
        bindLong(2, configId)
        executeUpdateDelete()
      }
    }

    return confirmedIds.size
  }

  /** One status bulk update; the caller owns the transaction. */
  private fun updateOperationStatus(ids: List<Long>, status: String) {
    val placeholders = ids.joinToString(", ") { "?" }
    appDb.compileStatement(
      "UPDATE operation_log SET status = ? WHERE id IN ($placeholders)",
    ).apply {
      bindString(1, status)
      ids.forEachIndexed { index, id -> bindLong(index + 2, id) }
      executeUpdateDelete()
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

/** The `bridge_config` columns the engine reads (single row, newest id). */
private data class BridgeConfigRow(
  val id: Long,
  val deviceId: String?,
  val ip: String?,
  val port: String?,
  val token: String?,
  val lastChangelogId: Long?,
)
