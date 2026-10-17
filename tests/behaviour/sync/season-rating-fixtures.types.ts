/** One `operation_log` row as read back. */
export interface StoredRow {
  readonly id: number;
  readonly operation: string;
  readonly status: string;
  readonly unresolved_reason: string | null;
  readonly claim_owner: string | null;
}

/** One row to seed; `id` doubles as its `created_at` offset. */
export interface SeededRow {
  readonly id: number;
  readonly operation: 'update' | 'season_rating';
  readonly animeId?: string;
  readonly payload?: Record<string, unknown>;
  readonly status?: string;
  readonly reason?: string | null;
}
