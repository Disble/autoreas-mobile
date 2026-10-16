package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase

/**
 * Applies one parsed reconcile response, all inside the ONE transaction the caller opened
 * (step 8), in the exact order the JS `applyReconcileResponseWrites` uses: staging first (it
 * may be what creates the row), then the token writes that depend on row existence, then the
 * status updates, then the cursor advance.
 *
 * Shared by BOTH attempt shapes so they cannot drift: the claimed path (non-empty backlog)
 * and the pull-only empty path, which passes an empty `backlog` — the staging inserts and the
 * cursor advance still run, while the confirmation and status passes no-op over zero rows.
 *
 * Token source is `applied_operations` ONLY — never `bridge_changes[].snapshot.modified_at`,
 * which the bridge hardcodes to 0. PRESENCE, not truthiness: an absent key contributes
 * nothing; `0` is a real token. When one anime appears more than once, the LAST entry wins.
 */
internal class SyncEngineResponseApplier(
  private val appDb: SQLiteDatabase,
  /** Bulk status update over `operation_log`; the owning cycle supplies its implementation. */
  private val updateOperationStatus: (ids: List<Long>, status: String) -> Unit,
  /**
   * One conflicted row's status and attempt count (ADR 009 R-15); the owning cycle supplies the
   * same claim-guarded implementation it uses for [updateOperationStatus].
   */
  private val writeConflictOutcome: (id: Long, status: String, attemptCount: Long) -> Unit,
  /**
   * The ids among the given ones the cycle's claim still holds, read inside the open
   * transaction: a token is only written for a key still held (ADR 009 R-13).
   */
  private val heldOperationIds: (ids: List<Long>) -> Set<Long>,
) {
  /**
   * Applies every write the response produced; returns the ids it confirmed that this claim
   * still held, in backlog order, so the cycle chains only keys it still holds (ADR 009 R-14).
   * A row the JS runtime took over mid-request is neither counted nor chained here.
   * [storedTokens] is each anime's token as sent in this attempt's request (its `base`): the
   * conflict rule compares the bridge's token against it.
   */
  fun apply(
    configId: Long,
    parsed: ParsedReconcileResponse,
    backlog: List<BacklogRow>,
    lastChangelogId: Long,
    storedTokens: Map<String, Long?>,
  ): List<Long> {
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

    val heldIds = heldOperationIds(backlog.map { it.id })
    val heldAnimeIds = backlog.filter { it.id in heldIds }.map { it.animeId }.toSet()
    val tokenByAnimeId = LinkedHashMap<String, Long>()
    for (entry in parsed.appliedOperations) {
      if (entry.applied && entry.modifiedAt != null && entry.animeId in heldAnimeIds) {
        tokenByAnimeId[entry.animeId] = entry.modifiedAt
      }
    }
    for ((animeId, bridgeModifiedAt) in tokenByAnimeId) {
      writeAnimeToken(animeId, bridgeModifiedAt)
    }

    val confirmedIds = ReconcileConfirmation.getConfirmedOperationIds(backlog, parsed)
    val confirmedIdSet = confirmedIds.toSet()

    // The conflict rule (ADR 009 R-15), shared with JS: `unsupported_operation` dead-letters, a
    // conflict re-bases the anime on the bridge's token and counts the attempt, and anything else
    // (no rejection, a conflict without a token, an unknown reason) goes back to `pending`.
    val deadLetterIds = mutableListOf<Long>()
    val pendingIds = mutableListOf<Long>()
    for (row in backlog) {
      if (row.id in confirmedIdSet) continue
      val rejected = parsed.appliedOperations.firstOrNull {
        it.animeId == row.animeId && it.operation == row.operation && !it.applied
      }
      val outcome = if (rejected == null) {
        RejectedOperationOutcome.StaysPending
      } else {
        classifyRejectedOperation(rejected, storedTokens[row.animeId], row.conflictAttemptCount)
      }
      when (outcome) {
        is RejectedOperationOutcome.DeadLetter -> deadLetterIds.add(row.id)
        is RejectedOperationOutcome.StaysPending -> pendingIds.add(row.id)
        is RejectedOperationOutcome.Conflict -> {
          if (row.id in heldIds) writeAnimeToken(row.animeId, outcome.bridgeModifiedAt)
          writeConflictOutcome(row.id, outcome.status, outcome.attemptCount)
        }
      }
    }

    if (deadLetterIds.isNotEmpty()) updateOperationStatus(deadLetterIds, "dead_letter")
    if (confirmedIds.isNotEmpty()) updateOperationStatus(confirmedIds, "synced")
    if (pendingIds.isNotEmpty()) updateOperationStatus(pendingIds, "pending")
    // A confirmed later edit supersedes the edits of its key given up before it (ADR 009 R-16b),
    // resolved in this same transaction, only for rows this claim still held.
    UnresolvedResolution.resolveSupersededGivenUpRows(
      appDb,
      backlog.filter { it.id in confirmedIdSet && it.id in heldIds },
    )

    val nextLastChangelogId = parsed.lastChangelogId ?: lastChangelogId
    if (nextLastChangelogId > lastChangelogId) {
      // Forward-only against the STORED value (ADR 009, R-6): JS may have advanced the cursor past
      // this cycle's snapshot while the request was in flight.
      appDb.compileStatement(
        "UPDATE bridge_config SET last_changelog_id = MAX(COALESCE(last_changelog_id, 0), ?) WHERE id = ?",
      ).apply {
        bindLong(1, nextLastChangelogId)
        bindLong(2, configId)
        executeUpdateDelete()
      }
    }

    return confirmedIds.filter { it in heldIds }
  }

  /** Stores one bridge-authored OCC token on its anime row. */
  private fun writeAnimeToken(animeId: String, bridgeModifiedAt: Long) {
    appDb.compileStatement(
      "UPDATE animes SET bridge_modified_at = ? WHERE _id = ?",
    ).apply {
      bindLong(1, bridgeModifiedAt)
      bindString(2, animeId)
      executeUpdateDelete()
    }
  }
}
