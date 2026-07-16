/** Creates the singleton advisory-lock table when missing; safe to run on every claim attempt. */
export const SYNC_CYCLE_LOCK_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS sync_cycle_lock (' +
  'id INTEGER PRIMARY KEY, ' +
  'owner TEXT NOT NULL, ' +
  'expires_at INTEGER NOT NULL)';

/** Provides the fixed row id used for the singleton advisory-lock row. */
export const SYNC_CYCLE_LOCK_ROW_ID = 1;

/** Provides the default lease duration for one claimed reconcile cycle. */
export const DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS = 60_000;
