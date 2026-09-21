/** Provides the fixed row id used for the singleton advisory-lock row. */
export const SYNC_CYCLE_LOCK_ROW_ID = 1;

/** Provides the default lease duration for one claimed reconcile cycle. */
export const DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS = 60_000;

/** Conditional UPSERT that claims the singleton cycle-lock row, stamping a per-claim fence token and succeeding only when the existing lease expired or is held by the same owner. */
export const CLAIM_SYNC_CYCLE_LOCK_SQL = [
  'INSERT INTO sync_cycle_lock (id, owner, expires_at, fence)',
  'VALUES (?, ?, ?, ?)',
  'ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at, fence = excluded.fence',
  'WHERE sync_cycle_lock.expires_at <= ? OR sync_cycle_lock.owner = excluded.owner',
].join(' ');

/** Ownership read-back query proving both `owner` and `fence` match a claim before its token is authoritative. */
export const READ_SYNC_CYCLE_LOCK_OWNERSHIP_SQL =
  'SELECT owner, fence FROM sync_cycle_lock WHERE id = ?';

/** Fence-scoped release deleting the row only when both the owner and the claim's own fence token still match. */
export const RELEASE_SYNC_CYCLE_LOCK_SQL =
  'DELETE FROM sync_cycle_lock WHERE id = ? AND owner = ? AND fence = ?';
