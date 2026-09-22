package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.util.Log

private const val RECOVERY_LOG_TAG = "SyncEngine"

private const val RETURN_ORPHANED_CLAIMS_SQL =
  "UPDATE operation_log SET status = 'pending' WHERE status = 'processing' AND " +
    LEASE_OWNERSHIP_GUARD_SQL

/**
 * The attempt states a later attempt may compensate (architecture doc 6.2): everything except
 * the terminal outcomes (`closed`, `failed`, `abandoned`, `not_applicable`).
 */
private val NON_TERMINAL_STATES = setOf("checked", "claimed", "sent", "applied", "pruned")

/**
 * What one recovery sweep reclaimed: the number of orphaned `processing` rows returned to
 * `pending`, and the cycle id of the abandoned attempt the journal named (or `null` when
 * there was nothing to abandon).
 */
data class RecoveryResult(
  val processingReturned: Int,
  val abandonedCycleId: String?,
  /** True when the lease was already lost before the sweep ran; the attempt must abandon. */
  val leaseLost: Boolean = false,
)

/**
 * The recovery sweep (ODD mobile-sync-native-engine T4 / architecture doc 6.2 invariant 2):
 * reclaims the durable state a previous attempt left behind when it died, so it does not
 * accumulate. It runs inside [expo.modules.syncengine.SyncEngineCycle] AFTER the cycle lease
 * is held — that is what makes it safe: while this engine holds the lease no other cycle can
 * be running, so every stale claim it finds is an orphan from an attempt that died — and
 * BEFORE the backlog is read, so the reclaimed rows are visible to this attempt's own claim.
 *
 * Two compensations, each independent and each best-effort (docs/mobile-sync-architecture.md
 * 6.2 — the compensations for `claimed` and for a non-terminal journaled state):
 * 1. **Abandon the stale attempt.** The journal's newest transition belonging to a DIFFERENT
 *    cycle id is the previous attempt's last recorded state (this attempt's own `checked`
 *    row is newer, so the absolute newest row is always ours and must be excluded). When that
 *    state is non-terminal (`checked`, `claimed`, `sent`, `applied`, `pruned`) and older than
 *    the cycle lease ([ENGINE_LEASE_MS], 60 s), an `abandoned` transition is appended for that
 *    cycle id, naming this attempt as the recoverer. Terminal states and fresh states are
 *    left alone.
 * 2. **Return the orphaned claim.** Every `operation_log` row still in `processing` goes back
 *    to `pending` inside one `BEGIN IMMEDIATE` transaction (the JS cycle already re-includes
 *    `processing` rows in its backlog read for exactly this reason; this makes the recovery
 *    explicit and durable).
 *
 * **A sweep error never fails the attempt**: every failure is logged under the `SyncEngine`
 * tag and reported through [RecoveryResult]'s zero/`null` defaults, and the attempt continues
 * with whatever state it found.
 */
class SyncEngineRecovery(
  private val appDb: SQLiteDatabase,
  private val journal: SyncEngineJournal,
) {

  /**
   * Runs both compensations and reports what they reclaimed. Never throws: each step is
   * individually guarded, so a journal failure cannot block the claim recovery and vice versa.
   * The whole sweep runs under the caller's fence: the orphan compensation is a destructive
   * write, so its statement is guarded by [LEASE_OWNERSHIP_GUARD_SQL] -- after a reclaim it
   * affects zero rows -- and a lease already lost before the sweep reports [RecoveryResult.leaseLost]
   * so the attempt abandons instead of writing on.
   */
  fun sweep(currentCycleId: String, lease: LeaseFence): RecoveryResult {
    if (!isSyncCycleLeaseOwnedBy(appDb, lease.owner, lease.fence)) {
      return RecoveryResult(processingReturned = 0, abandonedCycleId = null, leaseLost = true)
    }
    val abandonedCycleId = abandonStaleAttempt(currentCycleId)
    val processingReturned = returnOrphanedClaims(lease)
    return RecoveryResult(processingReturned, abandonedCycleId)
  }

  /**
   * Appends the `abandoned` transition for the previous attempt when its last journaled state
   * is non-terminal and older than the lease; answers its cycle id, or `null` when there was
   * nothing to abandon (or the journal could not be read).
   */
  private fun abandonStaleAttempt(currentCycleId: String): String? {
    return try {
      val latest = journal.readLatestTransition(currentCycleId) ?: return null
      val staleBefore = System.currentTimeMillis() - ENGINE_LEASE_MS
      val isStale = latest.atMs < staleBefore
      if (latest.toState !in NON_TERMINAL_STATES || !isStale) {
        return null
      }
      val appended = journal.append(
        latest.cycleId,
        latest.toState,
        "abandoned",
        "recovered by later attempt $currentCycleId",
        System.currentTimeMillis(),
      )
      if (appended) latest.cycleId else null
    } catch (error: Throwable) {
      Log.w(RECOVERY_LOG_TAG, "recovery sweep: stale-attempt abandon failed", error)
      null
    }
  }

  /**
   * Returns every orphaned `processing` row to `pending` inside one `BEGIN IMMEDIATE`
   * transaction, answering the number of rows reclaimed; `0` on any failure. The statement is
   * fenced: when this attempt's lease was reclaimed, the ownership guard selects nothing and the
   * update affects zero rows instead of clobbering the new owner's claims.
   */
  private fun returnOrphanedClaims(lease: LeaseFence): Int {
    return try {
      inImmediateTransaction(appDb) {
        appDb.compileStatement(RETURN_ORPHANED_CLAIMS_SQL).apply {
          bindString(1, lease.owner)
          bindString(2, lease.fence)
        }.executeUpdateDelete()
      }
    } catch (error: Throwable) {
      Log.w(RECOVERY_LOG_TAG, "recovery sweep: orphaned claim recovery failed", error)
      0
    }
  }
}
