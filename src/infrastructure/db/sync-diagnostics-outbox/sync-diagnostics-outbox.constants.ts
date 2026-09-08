/**
 * Caps the diagnostics outbox at 100 undelivered entries. Bounded so a device that never
 * reconnects cannot grow the outbox without limit; the `AFTER INSERT` trigger enforces this in
 * SQL, atomic with the insert, so the bound is never transiently exceeded.
 */
export const SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS = 100;

/**
 * Lock-wait budget for a diagnostics outbox write, mirroring the cycle checkpoint's own bound
 * (`SYNC_CYCLE_CHECKPOINT_BUSY_TIMEOUT_MS`). Only this process writes this file, so contention is
 * near zero; `busy_timeout` is the one bound that fires natively when JS timers are paused in the
 * headless runtime.
 */
export const SYNC_DIAGNOSTICS_OUTBOX_BUSY_TIMEOUT_MS = 250;

/** Creates the outbox table. `payload` is the exact JSON that would have gone on the wire. */
export const SYNC_DIAGNOSTICS_OUTBOX_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS sync_diagnostics_outbox (' +
  'cycle_id TEXT PRIMARY KEY, ' +
  'payload TEXT NOT NULL, ' +
  'created_at INTEGER NOT NULL)';

/**
 * Creates the singleton not-before-gate row. Read INSIDE the candidate `SELECT` (Decision 6), so
 * the caller has exactly one case to handle: `[]` means "nothing to send OR the gate is shut".
 */
export const SYNC_DIAGNOSTICS_OUTBOX_STATE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS sync_diagnostics_outbox_state (' +
  'id INTEGER PRIMARY KEY CHECK (id = 1), ' +
  'not_before INTEGER NOT NULL)';

/**
 * Dropped and recreated on every connect so the cap is owned by the code, not frozen into DDL
 * that `IF NOT EXISTS` would refuse to update on an already-provisioned device. The interpolated
 * bound is `SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS`, a numeric constant this file owns; a trigger body
 * cannot bind a parameter.
 */
export const SYNC_DIAGNOSTICS_OUTBOX_EVICT_TRIGGER_SQL =
  'DROP TRIGGER IF EXISTS sync_diagnostics_outbox_evict; ' +
  'CREATE TRIGGER sync_diagnostics_outbox_evict ' +
  'AFTER INSERT ON sync_diagnostics_outbox ' +
  `WHEN (SELECT COUNT(*) FROM sync_diagnostics_outbox) > ${SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS} ` +
  'BEGIN ' +
  'DELETE FROM sync_diagnostics_outbox WHERE rowid IN (' +
  'SELECT rowid FROM sync_diagnostics_outbox ' +
  'ORDER BY created_at ASC, rowid ASC ' +
  `LIMIT (SELECT COUNT(*) FROM sync_diagnostics_outbox) - ${SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS}` +
  '); ' +
  'END;';

/**
 * `DO NOTHING`, not `DO UPDATE`: `syncPendingOperations`'s rerun loop re-enters
 * `performSyncPendingOperations` with the SAME telemetryContext and therefore the same
 * `cycle_id` (`reconcile.helpers.ts:119-126`). The first capture wins, so `created_at` never
 * churns and the FIFO order stays stable across a rerun.
 */
export const SYNC_DIAGNOSTICS_OUTBOX_INSERT_SQL =
  'INSERT INTO sync_diagnostics_outbox (cycle_id, payload, created_at) ' +
  'VALUES (?, ?, ?) ' +
  'ON CONFLICT(cycle_id) DO NOTHING';

/**
 * Reads up to `limit` candidates oldest-first, gated by a sub-select against the singleton
 * not-before row -- a clock comparison folded into the query, never a JS branch or a timer.
 */
export const SYNC_DIAGNOSTICS_OUTBOX_SELECT_CANDIDATES_SQL =
  'SELECT cycle_id, payload, created_at FROM sync_diagnostics_outbox ' +
  'WHERE COALESCE((SELECT not_before FROM sync_diagnostics_outbox_state WHERE id = 1), 0) <= ? ' +
  'ORDER BY created_at ASC, rowid ASC ' +
  'LIMIT ?';

/** Removes one outbox entry by `cycle_id` -- delivered, or permanently rejected by the bridge. */
export const SYNC_DIAGNOSTICS_OUTBOX_REMOVE_SQL =
  'DELETE FROM sync_diagnostics_outbox WHERE cycle_id = ?';

/**
 * Upserts the singleton not-before row. Written ONLY when a response carries a parseable
 * `Retry-After`; never cleared, because a past timestamp is already open, and a transport
 * failure never sets it -- the trigger cadence already is the backoff.
 */
export const SYNC_DIAGNOSTICS_OUTBOX_STATE_UPSERT_SQL =
  'INSERT INTO sync_diagnostics_outbox_state (id, not_before) VALUES (1, ?) ' +
  'ON CONFLICT(id) DO UPDATE SET not_before = excluded.not_before';
