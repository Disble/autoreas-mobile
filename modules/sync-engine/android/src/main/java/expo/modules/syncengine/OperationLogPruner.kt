package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.util.Log

private const val PRUNE_LOG_TAG = "SyncEnginePrune"

/** Retention policy values, mirroring `DEFAULT_OPERATION_LOG_RETENTION_POLICY`. */
private const val RETENTION_DAY_MS = 24L * 60L * 60L * 1000L
private const val SYNCED_TTL_DAYS = 7L
private const val TERMINAL_TTL_DAYS = 30L
private const val SYNCED_MAX_COUNT = 1000
private const val TERMINAL_MAX_COUNT = 500

/**
 * Retention prune over the operation log, ported statement-for-statement from
 * `pruneOperationLog` (`operation-log-retention.helpers.ts`): TTL first, then max-count, per
 * status — `synced` 7 days / 1000 rows, `dead_letter` 30 days / 500, `conflict_exhausted`
 * 30 days / 500 — deleting only terminal statuses, oldest first. The caller owns the
 * transaction, exactly as the JS prune runs in its caller's write transaction.
 */
object OperationLogPruner {

  /**
   * Runs the whole prune inside the caller's already-open transaction. A failure is warned
   * about and swallowed: a prune failure must never fail the attempt (step 9 of the contract).
   */
  fun pruneSafely(appDb: SQLiteDatabase) {
    try {
      inImmediateTransaction(appDb) {
        val now = System.currentTimeMillis()
        pruneByTtl(appDb, "synced", now - SYNCED_TTL_DAYS * RETENTION_DAY_MS)
        pruneByTtl(appDb, "dead_letter", now - TERMINAL_TTL_DAYS * RETENTION_DAY_MS)
        pruneByTtl(appDb, "conflict_exhausted", now - TERMINAL_TTL_DAYS * RETENTION_DAY_MS)
        pruneByMaxCount(appDb, "synced", SYNCED_MAX_COUNT)
        pruneByMaxCount(appDb, "dead_letter", TERMINAL_MAX_COUNT)
        pruneByMaxCount(appDb, "conflict_exhausted", TERMINAL_MAX_COUNT)
      }
    } catch (error: Throwable) {
      Log.w(PRUNE_LOG_TAG, "operation-log pruning failed", error)
    }
  }

  /** Deletes rows of one terminal status older than the given cutoff, oldest first. */
  private fun pruneByTtl(appDb: SQLiteDatabase, status: String, cutoffTimestamp: Long) {
    appDb.compileStatement(
      "DELETE FROM operation_log" +
        " WHERE id IN (" +
        "  SELECT id FROM operation_log" +
        "  WHERE status = ? AND created_at < ?" +
        "  ORDER BY created_at ASC, id ASC" +
        ")",
    ).apply {
      bindString(1, status)
      bindLong(2, cutoffTimestamp)
      executeUpdateDelete()
    }
  }

  /** Deletes the oldest rows of one terminal status once its count exceeds [maxCount]. */
  private fun pruneByMaxCount(appDb: SQLiteDatabase, status: String, maxCount: Int) {
    val currentCount = appDb.rawQuery(
      "SELECT COUNT(*) FROM operation_log WHERE status = ?",
      arrayOf(status),
    ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }
    val overflowCount = maxOf(0L, currentCount - maxCount)
    if (overflowCount == 0L) return

    appDb.compileStatement(
      "DELETE FROM operation_log" +
        " WHERE id IN (" +
        "  SELECT id FROM operation_log" +
        "  WHERE status = ?" +
        "  ORDER BY created_at ASC, id ASC" +
        "  LIMIT ?" +
        ")",
    ).apply {
      bindString(1, status)
      bindLong(2, overflowCount)
      executeUpdateDelete()
    }
  }
}
