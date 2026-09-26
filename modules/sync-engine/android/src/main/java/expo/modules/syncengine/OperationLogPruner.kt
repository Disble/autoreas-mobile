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
 * 30 days / 500 — deleting only terminal statuses, oldest first. The prune opens its own
 * `BEGIN IMMEDIATE` transaction and verifies the cycle lease inside it (see `pruneSafely`).
 */
object OperationLogPruner {

  /**
   * Runs the whole prune inside one `BEGIN IMMEDIATE` transaction. A failure is warned
   * about and swallowed: a prune failure must never fail the attempt (step 9 of the contract).
   *
   * Fenced (ADR 008): [requireLeaseOwnership] runs as the FIRST statement inside the
   * transaction, so a lease reclaimed between the caller's last guarded write and this prune
   * aborts the prune with [LeaseLostException] before any row is deleted. The exception is
   * rethrown, not swallowed, so the cycle classifies it like every other lease loss
   * (`outcome = abandoned`, `LeaseLost`). A reclaim is itself a write, so the write lock taken
   * by `BEGIN IMMEDIATE` pins the fence for the whole transaction -- no claim can interleave
   * with the deletes.
   */
  fun pruneSafely(appDb: SQLiteDatabase, lease: LeaseFence) {
    try {
      inImmediateTransaction(appDb) {
        requireLeaseOwnership(appDb, lease)
        val now = System.currentTimeMillis()
        pruneByTtl(appDb, "synced", now - SYNCED_TTL_DAYS * RETENTION_DAY_MS)
        pruneByTtl(appDb, "dead_letter", now - TERMINAL_TTL_DAYS * RETENTION_DAY_MS)
        pruneByTtl(appDb, "conflict_exhausted", now - TERMINAL_TTL_DAYS * RETENTION_DAY_MS)
        pruneByMaxCount(appDb, "synced", SYNCED_MAX_COUNT)
        pruneByMaxCount(appDb, "dead_letter", TERMINAL_MAX_COUNT)
        pruneByMaxCount(appDb, "conflict_exhausted", TERMINAL_MAX_COUNT)
      }
    } catch (error: LeaseLostException) {
      // Fence contract: lease loss during the prune is not a prune failure -- rethrow so the
      // cycle classifies it as `abandoned` / `LeaseLost` instead of writing on.
      throw error
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

  /**
   * Deletes the oldest rows of one terminal status once its count exceeds [maxCount].
   *
   * `moveToFirst()`'s result is intentionally unchecked (T3, sync-core-test-assurance): a bare
   * `SELECT COUNT(*)` always returns exactly one row, even over zero matches, so the "no row"
   * branch a defensive `if (cursor.moveToFirst()) ... else 0L` would guard is unreachable for
   * this exact, unconditioned query shape -- proven, not assumed, and removed rather than
   * `Kover`-excluded, per this feature's unreachable-code decision.
   */
  private fun pruneByMaxCount(appDb: SQLiteDatabase, status: String, maxCount: Int) {
    val currentCount = appDb.rawQuery(
      "SELECT COUNT(*) FROM operation_log WHERE status = ?",
      arrayOf(status),
    ).use { cursor ->
      cursor.moveToFirst()
      cursor.getLong(0)
    }
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
