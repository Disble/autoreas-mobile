package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase

private const val UNSUPPORTED_OPERATION_REASON = "unsupported_operation"

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
) {
  /** Applies every write the response produced; returns the number of confirmed operations. */
  fun apply(
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
}
