/** One `season_rating_queue` row as the move reads it (migration-0009 columns only). */
export interface QueuedRatingRow {
  readonly id: number;
  readonly season_id: string;
  readonly anime_id: string;
  readonly nota: number;
  readonly rated_at: number;
  readonly status: string;
  readonly created_at: number;
  readonly last_failure_kind: string | null;
}

/** The `operation_log` row one queued rating becomes. */
export interface MovedRatingOperation {
  readonly animeId: string;
  readonly payload: string;
  readonly status: 'pending' | 'dead_letter';
  readonly createdAt: number;
  readonly unresolvedReason: string | null;
}
