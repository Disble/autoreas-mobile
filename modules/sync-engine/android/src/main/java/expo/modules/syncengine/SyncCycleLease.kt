package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.util.Log

private const val LEASE_LOG_TAG = "SyncEngineLease"

private const val CLAIM_LEASE_SQL =
  "INSERT INTO sync_cycle_lock (id, owner, expires_at)" +
    "VALUES (?, ?, ?)" +
    "ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at" +
    " WHERE sync_cycle_lock.expires_at <= ? OR sync_cycle_lock.owner = excluded.owner"

private const val RELEASE_LEASE_SQL = "DELETE FROM sync_cycle_lock WHERE id = ? AND owner = ?"

/**
 * Claims and releases the singleton `sync_cycle_lock` row for the native engine, exactly like
 * `claimSyncCycleLock`/`releaseSyncCycleLock` (`sync-cycle-lock.helpers.ts`) do for the JS
 * cycle: one conditional UPSERT whose `WHERE` only succeeds when the existing lease expired or
 * is already ours, so two owners can never both claim it at once. The engine's owner value
 * ([ENGINE_LOCK_OWNER]) is distinct from the JS cycle's, but the row — and therefore the
 * mutual exclusion — is the same one.
 *
 * A claim is verified by reading the row's `owner` back rather than by an affected-rows count:
 * on Android `executeUpdateDelete()` does not reliably describe an INSERT's outcome (an insert
 * that created the row and a `DO UPDATE ... WHERE` that was filtered out both report through a
 * count that does not distinguish "we own it now" from "someone else still holds it"), while the
 * stored `owner` is the single source of truth for who holds the lease.
 */
class SyncCycleLease(private val appDb: SQLiteDatabase) {

  /**
   * Claims the lease for one attempt starting now. Binds all four placeholders of
   * [CLAIM_LEASE_SQL] in order (id, owner, expires_at, and the `WHERE` cutoff), then verifies
   * ownership by selecting the row's `owner` back inside the same call. A missing
   * `sync_cycle_lock` table (a store that has not had its first foreground open) reports
   * unclaimed rather than throwing, mirroring the JS `SchemaNotReadyError` -> no-op handling.
   */
  fun claim(): Boolean {
    return try {
      val now = System.currentTimeMillis()
      val statement = appDb.compileStatement(CLAIM_LEASE_SQL)
      statement.bindLong(1, 1L)
      statement.bindString(2, ENGINE_LOCK_OWNER)
      statement.bindLong(3, now + ENGINE_LEASE_MS)
      statement.bindLong(4, now)
      statement.executeUpdateDelete()
      appDb.rawQuery("SELECT owner FROM sync_cycle_lock WHERE id = ?", arrayOf("1")).use { cursor ->
        cursor.moveToFirst() && cursor.getString(0) == ENGINE_LOCK_OWNER
      }
    } catch (error: SQLiteException) {
      Log.w(LEASE_LOG_TAG, "sync_cycle_lock unreadable (schema not ready?)", error)
      false
    }
  }

  /**
   * Releases the lease by deleting the row we own. A release failure is warned about and
   * swallowed: the lease's own expiry is the designed backstop (same masking rule as the JS
   * helper's `finally`).
   */
  fun release() {
    try {
      val statement = appDb.compileStatement(RELEASE_LEASE_SQL)
      statement.bindLong(1, 1L)
      statement.bindString(2, ENGINE_LOCK_OWNER)
      statement.executeUpdateDelete()
    } catch (error: Throwable) {
      Log.w(LEASE_LOG_TAG, "lease release failed", error)
    }
  }
}
