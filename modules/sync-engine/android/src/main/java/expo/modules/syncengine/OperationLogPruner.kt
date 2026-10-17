package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.util.Log

private const val PRUNE_LOG_TAG = "SyncEnginePrune"

/** Retention policy values: synced rows live 7 days, at most 1000 of them. */
private const val RETENTION_DAY_MS = 24L * 60L * 60L * 1000L
private const val SYNCED_TTL_DAYS = 7L
private const val SYNCED_MAX_COUNT = 1000

/**
 * Retention prune over the operation log, the only one in the app (JS has no background
 * responsibility, ADR 009 constraint 2): TTL first, then max-count, over `synced` rows only — 7 days / 1000 rows, oldest first. Given-up rows (`dead_letter`,
 * `conflict_exhausted`) are unresolved keys and are never pruned: they stay until a later
 * confirmed edit or `resolveUnresolvedKey` resolves them (ADR 009 R-16b). The prune opens its
 * own `BEGIN IMMEDIATE` transaction and verifies the cycle lease inside it (see `pruneSafely`).
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
        pruneSyncedByTtl(appDb, now - SYNCED_TTL_DAYS * RETENTION_DAY_MS)
        pruneSyncedByMaxCount(appDb)
      }
    } catch (error: LeaseLostException) {
      // Fence contract: lease loss during the prune is not a prune failure -- rethrow so the
      // cycle classifies it as `abandoned` / `LeaseLost` instead of writing on.
      throw error
    } catch (error: Throwable) {
      Log.w(PRUNE_LOG_TAG, "operation-log pruning failed", error)
    }
  }

  /** Deletes `synced` rows older than the given cutoff, oldest first. */
  private fun pruneSyncedByTtl(appDb: SQLiteDatabase, cutoffTimestamp: Long) {
    appDb.compileStatement(
      "DELETE FROM operation_log" +
        " WHERE id IN (" +
        "  SELECT id FROM operation_log" +
        "  WHERE status = 'synced' AND created_at < ?" +
        "  ORDER BY created_at ASC, id ASC" +
        ")",
    ).apply {
      bindLong(1, cutoffTimestamp)
      executeUpdateDelete()
    }
  }

  /**
   * Deletes the oldest `synced` rows once their count exceeds [SYNCED_MAX_COUNT].
   *
   * `moveToFirst()`'s result is intentionally unchecked (T3, sync-core-test-assurance): a bare
   * `SELECT COUNT(*)` always returns exactly one row, even over zero matches, so the "no row"
   * branch a defensive `if (cursor.moveToFirst()) ... else 0L` would guard is unreachable for
   * this exact, unconditioned query shape -- proven, not assumed, and removed rather than
   * `Kover`-excluded, per this feature's unreachable-code decision.
   */
  private fun pruneSyncedByMaxCount(appDb: SQLiteDatabase) {
    val currentCount = appDb.rawQuery(
      "SELECT COUNT(*) FROM operation_log WHERE status = 'synced'",
      null,
    ).use { cursor ->
      cursor.moveToFirst()
      cursor.getLong(0)
    }
    val overflowCount = maxOf(0L, currentCount - SYNCED_MAX_COUNT)
    if (overflowCount == 0L) return

    appDb.compileStatement(
      "DELETE FROM operation_log" +
        " WHERE id IN (" +
        "  SELECT id FROM operation_log" +
        "  WHERE status = 'synced'" +
        "  ORDER BY created_at ASC, id ASC" +
        "  LIMIT ?" +
        ")",
    ).apply {
      bindLong(1, overflowCount)
      executeUpdateDelete()
    }
  }
}
