/** Finds the retired queue table; present only on a device that has not run the move yet. */
export const SEASON_RATING_QUEUE_LOOKUP_SQL =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'season_rating_queue'";

/**
 * Reads every queued rating in the order it was queued. It names only migration-0009 columns, so a
 * table that never received the 0018 claim columns still moves, and an old claim is never carried.
 */
export const SEASON_RATING_QUEUE_READ_SQL =
  'SELECT id, season_id, anime_id, nota, rated_at, status, created_at, last_failure_kind ' +
  'FROM season_rating_queue ORDER BY created_at, id';

/** Inserts one moved rating as an unclaimed `operation_log` row with a fresh conflict budget. */
export const SEASON_RATING_OPERATION_INSERT_SQL =
  'INSERT INTO operation_log (anime_id, operation, payload, status, created_at, conflict_attempt_count, claim_owner, claimed_at, unresolved_reason) ' +
  "VALUES (?, 'season_rating', ?, ?, ?, 0, NULL, NULL, ?)";

/** Drops the retired queue; its index goes with it. */
export const SEASON_RATING_QUEUE_DROP_SQL = 'DROP TABLE season_rating_queue';

/**
 * The `last_failure_kind` values of a given-up (`failed`) rating that the bridge refused: they
 * become unresolved (`dead_letter`) with the kind as `unresolved_reason`, exactly the reasons the
 * rating sender writes (ADR 009 R-5). Every other failed rating -- `unreachable`,
 * `unexpected_response` or no kind -- failed to arrive, so it goes back to `pending`.
 */
export const UNRESOLVED_QUEUED_RATING_KINDS: readonly string[] = ['auth_repair', 'conflict', 'not_found', 'rejected'];
