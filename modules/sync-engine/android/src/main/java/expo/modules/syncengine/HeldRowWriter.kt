package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase

/**
 * Every write a claim holder makes to its own `operation_log` rows, FENCED twice:
 * - on the lease: [requireLeaseOwnership] throws [LeaseLostException] when the lease no longer
 *   names this attempt, so the caller's transaction rolls back and the attempt abandons;
 * - on the claim (ADR 009 R-13): each statement is compare-and-set, so a row the JS runtime
 *   confirmed or took over after this claim expired is never touched. Zero rows is therefore a
 *   lost KEY, not a lost lease, and is not an error.
 *
 * [fence] and [claim] are read on every write: the owning cycle adopts both only once it holds
 * them, and a write before that throws through [fence].
 */
internal class HeldRowWriter(
  private val appDb: SQLiteDatabase,
  private val fence: () -> LeaseFence,
  private val claim: () -> OutboxClaim,
) {
  /**
   * Bulk status update that releases the claim. Covers the failure revert and the response
   * applier's confirmation, dead-letter and pending passes; callers never pass an empty [ids].
   */
  fun updateOperationStatus(ids: List<Long>, status: String) {
    val heldFence = fence()
    requireLeaseOwnership(appDb, heldFence)
    val heldClaim = claim()
    val placeholders = ids.joinToString(", ") { "?" }
    appDb.compileStatement(
      "UPDATE operation_log SET status = ?, claim_owner = NULL, claimed_at = NULL " +
        "WHERE id IN ($placeholders) AND status = 'processing' AND claim_owner = ? " +
        "AND claimed_at = ? AND $LEASE_OWNERSHIP_GUARD_SQL",
    ).run {
      bindString(1, status)
      ids.forEachIndexed { index, id -> bindLong(index + 2, id) }
      bindString(ids.size + 2, heldClaim.owner)
      bindLong(ids.size + 3, heldClaim.claimedAt)
      bindString(ids.size + 4, heldFence.owner)
      bindString(ids.size + 5, heldFence.fence)
      executeUpdateDelete()
    }
  }

  /** Writes one conflicted row's status and attempt count and releases the claim (ADR 009 R-15). */
  fun writeConflictOutcome(id: Long, status: String, attemptCount: Long) {
    val heldFence = fence()
    requireLeaseOwnership(appDb, heldFence)
    val heldClaim = claim()
    appDb.compileStatement(
      "UPDATE operation_log SET status = ?, conflict_attempt_count = ?, claim_owner = NULL, " +
        "claimed_at = NULL WHERE id = ? AND status = 'processing' AND claim_owner = ? " +
        "AND claimed_at = ? AND $LEASE_OWNERSHIP_GUARD_SQL",
    ).run {
      bindString(1, status)
      bindLong(2, attemptCount)
      bindLong(3, id)
      bindString(4, heldClaim.owner)
      bindLong(5, heldClaim.claimedAt)
      bindString(6, heldFence.owner)
      bindString(7, heldFence.fence)
      executeUpdateDelete()
    }
  }

  /**
   * Gives a key up (ADR 009 R-3): its held rows and its unclaimed pending rows become `dead_letter`
   * with [reason], all released. The whole key goes, since none of its rows can carry a base.
   */
  fun giveKeyUp(animeId: String, heldIds: List<Long>, reason: String) {
    val heldFence = fence()
    requireLeaseOwnership(appDb, heldFence)
    val heldClaim = claim()
    val placeholders = heldIds.joinToString(", ") { "?" }
    appDb.compileStatement(
      "UPDATE operation_log SET status = 'dead_letter', unresolved_reason = ?, claim_owner = NULL, " +
        "claimed_at = NULL WHERE ((id IN ($placeholders) AND status = 'processing' AND claim_owner = ? " +
        "AND claimed_at = ?) OR (anime_id = ? AND status = 'pending' AND claimed_at IS NULL)) " +
        "AND $LEASE_OWNERSHIP_GUARD_SQL",
    ).run {
      bindString(1, reason)
      heldIds.forEachIndexed { index, id -> bindLong(index + 2, id) }
      bindString(heldIds.size + 2, heldClaim.owner)
      bindLong(heldIds.size + 3, heldClaim.claimedAt)
      bindString(heldIds.size + 4, animeId)
      bindString(heldIds.size + 5, heldFence.owner)
      bindString(heldIds.size + 6, heldFence.fence)
      executeUpdateDelete()
    }
  }

  /**
   * Stores a fetched token (ADR 009 R-3): only the token, only while none is stored, and only
   * while this claim still holds a row of [animeId]. An unpair or a JS takeover during the fetch
   * leaves no held row, so the old pairing's token is never written back.
   */
  fun storeMissingToken(animeId: String, token: Long) {
    val heldClaim = claim()
    appDb.compileStatement(
      "UPDATE animes SET bridge_modified_at = ? WHERE _id = ? AND bridge_modified_at IS NULL " +
        "AND EXISTS (SELECT 1 FROM operation_log WHERE anime_id = animes._id " +
        "AND status = 'processing' AND claim_owner = ? AND claimed_at = ?)",
    ).run {
      bindLong(1, token)
      bindString(2, animeId)
      bindString(3, heldClaim.owner)
      bindLong(4, heldClaim.claimedAt)
      executeUpdateDelete()
    }
  }

  /**
   * The ids among [ids] this claim still holds, read inside the caller's transaction: a key the
   * JS runtime took over mid-request is not ours to write, not even its token.
   */
  fun heldOperationIds(ids: List<Long>): Set<Long> = readHeldOperationIds(appDb, ids, claim()).toSet()
}
