package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase

/**
 * How long a per-key outbox claim stays live after `claimed_at` (ADR 009 R-13); mirrors
 * `OUTBOX_CLAIM_TTL_MS`. Past it, the other runtime may take the key and recovery may reset it.
 */
const val OUTBOX_CLAIM_TTL_MS = 60_000L

/** The `claim_owner` value the `:sync` process writes. The JS runtime writes `'js'`. */
const val NATIVE_OUTBOX_CLAIM_OWNER = "native"

/**
 * Identifies one claim exactly. A row is still held only while BOTH columns match: a key the
 * other runtime took over after expiry carries a different owner or time.
 */
data class OutboxClaim(val owner: String, val claimedAt: Long)

/** A claim no row carries: compare-and-set writes under it match nothing. */
val UNCLAIMED = OutboxClaim(owner = "", claimedAt = 0L)

/** The epoch-ms floor above which a `claimed_at` is still live at [now]. */
fun liveClaimFloor(now: Long): Long = now - OUTBOX_CLAIM_TTL_MS

/** Mirrors `buildDedupedBacklogQuery` with the live-claim key exclusion (R-13). */
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
    "  AND anime_id NOT IN (SELECT anime_id FROM operation_log WHERE claimed_at > ?)" +
    ")" +
    "WHERE animeRank = 1" +
    " ORDER BY createdAt ASC, id ASC" +
    " LIMIT ?"

/**
 * Reads the deduped backlog (step 4), leaving out every key with a live claim, and claims it
 * compare-and-set inside the caller's open `BEGIN IMMEDIATE`. Answers only the rows this claim won.
 */
fun claimOperationLogBacklog(
  appDb: SQLiteDatabase,
  cycleClaim: OutboxClaim,
  limit: Int,
): List<BacklogRow> {
  val claimFloor = liveClaimFloor(cycleClaim.claimedAt)
  val candidates = readBacklog(appDb, claimFloor, limit)
  if (candidates.isEmpty()) return candidates
  val placeholders = candidates.joinToString(", ") { "?" }
  appDb.compileStatement(
    "UPDATE operation_log SET status = 'processing', claim_owner = ?, claimed_at = ? " +
      "WHERE id IN ($placeholders) AND status IN ('pending', 'processing') " +
      "AND (claimed_at IS NULL OR claimed_at <= ?)",
  ).run {
    bindString(1, cycleClaim.owner)
    bindLong(2, cycleClaim.claimedAt)
    candidates.forEachIndexed { index, row -> bindLong(index + 3, row.id) }
    bindLong(candidates.size + 3, claimFloor)
    executeUpdateDelete()
  }
  val held = readHeldOperationIds(appDb, candidates.map { it.id }, cycleClaim).toSet()
  return candidates.filter { it.id in held }
}

/** Answers the ids among [ids] that [heldClaim] still holds, exactly. */
private fun readHeldOperationIds(appDb: SQLiteDatabase, ids: List<Long>, heldClaim: OutboxClaim): List<Long> {
  if (ids.isEmpty()) return emptyList()
  val placeholders = ids.joinToString(", ") { "?" }
  val args = ids.map { it.toString() } + listOf(heldClaim.owner, heldClaim.claimedAt.toString())
  return appDb.rawQuery(
    "SELECT id FROM operation_log WHERE id IN ($placeholders) " +
      "AND status = 'processing' AND claim_owner = ? AND claimed_at = ?",
    args.toTypedArray(),
  ).use { cursor ->
    buildList { while (cursor.moveToNext()) add(cursor.getLong(0)) }
  }
}

/**
 * Reads the deduped backlog verbatim from `buildDedupedBacklogQuery`, skipping every key with
 * a claim above [claimFloor].
 */
private fun readBacklog(appDb: SQLiteDatabase, claimFloor: Long, limit: Int): List<BacklogRow> {
  val rows = mutableListOf<BacklogRow>()
  appDb.rawQuery(
    BACKLOG_QUERY,
    arrayOf("pending", "processing", claimFloor.toString(), limit.toString()),
  ).use { cursor ->
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
