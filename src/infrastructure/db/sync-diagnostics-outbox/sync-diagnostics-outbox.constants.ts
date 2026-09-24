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
 * Name of the additive `shed for capacity` counter's table. A module-level constant instead of a
 * literal repeated in two statements: the `CREATE TABLE` that provisions it and the trigger body
 * that increments it must name the same table, and a divergence between them would surface only at
 * runtime as a failing write.
 */
const SYNC_DIAGNOSTICS_OUTBOX_SHED_COUNT_TABLE = 'sync_diagnostics_outbox_shed_count';

/**
 * Creates the outbox's additive `shed for capacity` counter -- the number of rows the cap trigger
 * has dropped at the door, cumulative and persisted.
 *
 * A NEW table created with `IF NOT EXISTS`, deliberately not a column added to an existing one.
 * This DDL is re-executed on every connect and there is no migration path here, so the only shape
 * that can provision an ALREADY-installed device is one whose re-run is idempotent: `CREATE TABLE
 * IF NOT EXISTS` is, and `ALTER TABLE ... ADD COLUMN` is not -- it fails on the second connect,
 * which is every connect after the first.
 *
 * A table rather than a JavaScript variable because the loss happens INSIDE the trigger, in
 * SQLite, where no JavaScript observes it: the `DELETE` that drops the overflow is the only place
 * the true number exists, so the same statement is the only place that can record it without a
 * read-compare-write race that could double-count or miss a shed under a concurrent insert.
 */
export const SYNC_DIAGNOSTICS_OUTBOX_SHED_COUNT_TABLE_SQL =
  `CREATE TABLE IF NOT EXISTS ${SYNC_DIAGNOSTICS_OUTBOX_SHED_COUNT_TABLE} (` +
  'id INTEGER PRIMARY KEY CHECK (id = 1), ' +
  'shed_rows INTEGER NOT NULL)';

/**
 * Reads the singleton shed counter. Returns NO row until the first shed, so the reader has exactly
 * one case to handle and reports `0` rather than having to interpret a missing row.
 */
export const SYNC_DIAGNOSTICS_OUTBOX_SHED_COUNT_SELECT_SQL =
  `SELECT shed_rows FROM ${SYNC_DIAGNOSTICS_OUTBOX_SHED_COUNT_TABLE} WHERE id = 1`;

/**
 * Dropped and recreated on every connect so the cap is owned by the code, not frozen into DDL
 * that `IF NOT EXISTS` would refuse to update on an already-provisioned device. The interpolated
 * bound is `SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS`, a numeric constant this file owns; a trigger body
 * cannot bind a parameter.
 *
 * **Eviction sheds the TAIL, and the ordering is load-bearing rather than cosmetic.** The cap
 * still exists for its original reason -- a device that never reconnects cannot grow the outbox
 * without limit, and because the cap is enforced by an `AFTER INSERT` trigger atomic with the
 * insert, the bound is never transiently exceeded. What the ordering adds is the delivery
 * guarantee: `SYNC_DIAGNOSTICS_OUTBOX_SELECT_CANDIDATES_SQL` reads OLDEST-first, so the surviving
 * window must be that same oldest prefix. Under the previous `created_at ASC, rowid ASC` the
 * trigger deleted exactly the rows a drainer reads first, so an insert could destroy a row another
 * consumer had already read as a candidate -- and when the POST for that row then failed, the
 * observation was gone with nothing recording it. That made the bridge's own promise ("a delivery
 * failure never silently loses it"; a repeated `cycle_id` is a no-op, so a caller may retry blind)
 * false in the very case it was written for.
 *
 * With `created_at DESC, rowid DESC` the shed rows are always the newest overflow, so the retained
 * prefix is the oldest rows and a row in flight is unreachable by eviction: it can only be removed
 * by the drainer that owns it. No claim, no lease, no per-row state, no migration.
 *
 * The guarantee holds ONLY while this order stays the exact inverse of the candidate read's order;
 * see the retained-prefix invariant test in
 * `tests/infrastructure/db/sync-diagnostics-outbox.helpers.test.ts`, which is what fails if either
 * read is ever filtered or reordered. The tiebreak is deterministic (`rowid`) so two rows sharing
 * a `created_at` -- the common case, since `now` is not guaranteed to advance between inserts --
 * still shed the same way every time.
 *
 * Stated cost, not hidden: tail-shedding trades freshness for durability. After a long outage the
 * retained telemetry is the ONSET of the problem rather than its current state.
 *
 * The `DELETE` is followed by the counter write INSIDE the same trigger, so it is atomic with the
 * insert that caused the shed: `changes()` reports the rows that statement ACTUALLY removed, never
 * the overflow the `WHEN` clause predicted, so a partial or unexpected delete can never be counted
 * as a full one. Nothing else in this store observes the shed, so the counter would be lost if the
 * trigger did not write it here.
 */
export const SYNC_DIAGNOSTICS_OUTBOX_EVICT_TRIGGER_SQL =
  'DROP TRIGGER IF EXISTS sync_diagnostics_outbox_evict; ' +
  'CREATE TRIGGER sync_diagnostics_outbox_evict ' +
  'AFTER INSERT ON sync_diagnostics_outbox ' +
  `WHEN (SELECT COUNT(*) FROM sync_diagnostics_outbox) > ${SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS} ` +
  'BEGIN ' +
  'DELETE FROM sync_diagnostics_outbox WHERE rowid IN (' +
  'SELECT rowid FROM sync_diagnostics_outbox ' +
  'ORDER BY created_at DESC, rowid DESC ' +
  `LIMIT (SELECT COUNT(*) FROM sync_diagnostics_outbox) - ${SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS}` +
  '); ' +
  `INSERT INTO ${SYNC_DIAGNOSTICS_OUTBOX_SHED_COUNT_TABLE} (id, shed_rows) VALUES (1, changes()) ` +
  'ON CONFLICT(id) DO UPDATE SET shed_rows = shed_rows + excluded.shed_rows; ' +
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
