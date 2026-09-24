package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.util.Log

private const val LEASE_LOG_TAG = "SyncEngineLease"

private const val CLAIM_LEASE_SQL =
  "INSERT INTO sync_cycle_lock (id, owner, expires_at, fence)" +
    "VALUES (?, ?, ?, ?)" +
    " ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at," +
    " fence = excluded.fence" +
    " WHERE sync_cycle_lock.expires_at <= ? OR (sync_cycle_lock.owner = excluded.owner" +
    " AND sync_cycle_lock.fence = excluded.fence)"

private const val RELEASE_LEASE_SQL =
  "DELETE FROM sync_cycle_lock WHERE id = ? AND owner = ? AND fence = ?"

private const val READ_OWNERSHIP_SQL = "SELECT owner, fence FROM sync_cycle_lock WHERE id = ?"

/**
 * Thrown when a fence-scoped write found the lease no longer held by this attempt: a later
 * attempt reclaimed the expired lease and stamped its own fence on the row. The cycle catches
 * it, records the `abandoned` journal transition, and stops writing -- never silently continuing.
 */
class LeaseLostException(message: String) : IllegalStateException(message)

/**
 * The owner/fence pair one attempt writes under. Every destructive or monotonic engine write is
 * guarded by it: the statement only affects rows while the singleton lease row still names this
 * exact pair, so a reclaimed lease rejects the previous owner's writes (ADR 008's fencing
 * invariant).
 */
data class LeaseFence(val owner: String, val fence: String)

/**
 * Claims and releases the singleton `sync_cycle_lock` row for the native engine, exactly like
 * `claimSyncCycleLock`/`releaseSyncCycleLock` (`sync-cycle-lock.helpers.ts`) do for the JS
 * cycle: one conditional UPSERT whose `WHERE` only succeeds when the existing lease expired or
 * is already ours, so two owners can never both claim it at once. The engine's owner value
 * ([ENGINE_LOCK_OWNER]) is distinct from the JS cycle's, but the row — and therefore the
 * mutual exclusion — is the same one.
 *
 * Each claim stamps the attempt's cycle id as the row's FENCE token — a unique per-claim value,
 * not a counter, so no read-modify-write race exists and the token doubles as per-attempt
 * identity. A claim is verified by reading the row's `owner` AND `fence` back rather than by an
 * affected-rows count: on Android `executeUpdateDelete()` does not reliably describe an INSERT's
 * outcome (an insert that created the row and a `DO UPDATE ... WHERE` that was filtered out both
 * report through a count that does not distinguish "we own it now" from "someone else still
 * holds it"), while the stored pair is the single source of truth for who holds the lease.
 *
 * The fence is what makes a RECLAIMED lease reject the previous owner's writes: once a later
 * claimant overwrites `fence`, this attempt's release affects zero rows and every
 * [LEASE_OWNERSHIP_GUARD_SQL]-guarded write affects zero rows. Without it, a lease lapse would
 * only prevent new claims while the previous owner could still delete whatever row is current.
 */
class SyncCycleLease(private val appDb: SQLiteDatabase) {

  /**
   * The fence token this attempt claimed, or `null` while no lease is held. Non-null implies
   * the row was read back naming [ENGINE_LOCK_OWNER] and this exact token.
   */
  var leaseFence: LeaseFence? = null
    private set

  /**
   * Claims the lease for one attempt, binding the attempt's [fence] token (its cycle id).
   * Binds all five placeholders of [CLAIM_LEASE_SQL] in order (id, owner, expires_at, fence,
   * and the `WHERE` cutoff), then verifies ownership by selecting the row's `owner` and `fence`
   * back inside the same call. A missing `sync_cycle_lock` table (a store that has not had its
   * first foreground open) reports unclaimed rather than throwing, mirroring the JS
   * `SchemaNotReadyError` -> no-op handling.
   */
  fun claim(fence: String): Boolean {
    return try {
      val now = System.currentTimeMillis()
      val statement = appDb.compileStatement(CLAIM_LEASE_SQL)
      statement.bindLong(1, ENGINE_LOCK_ROW_ID)
      statement.bindString(2, ENGINE_LOCK_OWNER)
      statement.bindLong(3, now + ENGINE_LEASE_MS)
      statement.bindString(4, fence)
      statement.bindLong(5, now)
      statement.executeUpdateDelete()
      val owned = isSyncCycleLeaseOwnedBy(appDb, ENGINE_LOCK_OWNER, fence)
      leaseFence = if (owned) LeaseFence(ENGINE_LOCK_OWNER, fence) else null
      owned
    } catch (error: SQLiteException) {
      Log.w(LEASE_LOG_TAG, "sync_cycle_lock unreadable (schema not ready?)", error)
      false
    }
  }

  /**
   * Releases the lease by deleting the row we still own, scoped by BOTH the owner and this
   * attempt's fence: after a reclaim the statement affects zero rows and the row keeps
   * belonging to the current holder. A release failure is warned about and swallowed: the
   * lease's own expiry is the designed backstop (same masking rule as the JS helper's
   * `finally`).
   */
  fun release() {
    val fence = leaseFence ?: return
    try {
      val statement = appDb.compileStatement(RELEASE_LEASE_SQL)
      statement.bindLong(1, ENGINE_LOCK_ROW_ID)
      statement.bindString(2, ENGINE_LOCK_OWNER)
      statement.bindString(3, fence.fence)
      statement.executeUpdateDelete()
    } catch (error: Throwable) {
      Log.w(LEASE_LOG_TAG, "lease release failed", error)
    }
  }
}
