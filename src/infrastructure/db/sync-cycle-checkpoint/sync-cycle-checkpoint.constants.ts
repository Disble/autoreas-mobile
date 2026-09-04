/**
 * Names the SQLite file the cycle checkpoint is written to.
 *
 * A SEPARATE file, deliberately, and this is the load-bearing decision of the whole instrument.
 * The app database's write door is keyed by file path -- `client.helpers.ts:288` reads
 * `rawDb.databasePath ?? DATABASE_NAME` -- so every connection opened against `autoreas.db`
 * queues behind the same door, proven by `tests/infrastructure/db/write-queue.test.ts`. A
 * checkpoint written through that door would queue behind the very hang it exists to report and
 * would never land, leaving a stale stage that reads as a confident, wrong answer. A dedicated
 * CONNECTION is not enough; only a dedicated FILE breaks both the JS queue and SQLite's own
 * file-level write lock.
 */
export const SYNC_CYCLE_CHECKPOINT_DATABASE_NAME = 'autoreas-telemetry.db';

/**
 * Lock-wait budget for a checkpoint write, deliberately far below the app database's 5 s.
 *
 * Best-effort saves the cycle from a checkpoint ERROR but not from a checkpoint that merely
 * waits, and a wait is paid out of the same job budget the instrument is measuring. Only this
 * process writes this file, so contention is near zero and the value is insurance rather than a
 * routine cost. It is also the ONLY bound available here: every JS timer bound is dead in the
 * background task (the HeadlessJsTask that keeps `setTimeout` alive is never registered), so
 * `busy_timeout` -- enforced natively inside SQLite -- is the one that actually fires.
 */
export const SYNC_CYCLE_CHECKPOINT_BUSY_TIMEOUT_MS = 250;

/** Creates the single-row checkpoint table. This file has no migrations; this is its whole schema. */
export const SYNC_CYCLE_CHECKPOINT_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS sync_cycle_checkpoint (' +
  'id INTEGER PRIMARY KEY CHECK (id = 1), ' +
  'cycle_id TEXT NOT NULL, ' +
  'stage TEXT NOT NULL, ' +
  'stage_at INTEGER NOT NULL, ' +
  'started_at INTEGER NOT NULL, ' +
  'failed_checkpoint_count INTEGER NOT NULL DEFAULT 0)';

/**
 * Upserts the singleton checkpoint row, refusing to move the stage BACKWARDS within one cycle.
 *
 * Two cycles can overlap (an FGS tick and the WorkManager task), so a slower path can write after
 * a faster one. Ordering is enforced in SQL rather than by chaining the writes in JS on purpose:
 * a JS chain is exactly the jammed-queue failure this instrument exists to survive. The
 * `cycle_id` disjunct lets a genuinely new cycle claim the row even if the device clock moved
 * backwards, so a bad clock cannot wedge the instrument permanently.
 */
export const SYNC_CYCLE_CHECKPOINT_UPSERT_SQL =
  'INSERT INTO sync_cycle_checkpoint ' +
  '(id, cycle_id, stage, stage_at, started_at, failed_checkpoint_count) ' +
  'VALUES (1, ?, ?, ?, ?, ?) ' +
  'ON CONFLICT(id) DO UPDATE SET ' +
  'cycle_id = excluded.cycle_id, ' +
  'stage = excluded.stage, ' +
  'stage_at = excluded.stage_at, ' +
  'started_at = excluded.started_at, ' +
  'failed_checkpoint_count = excluded.failed_checkpoint_count ' +
  'WHERE excluded.cycle_id <> sync_cycle_checkpoint.cycle_id ' +
  'OR excluded.stage_at >= sync_cycle_checkpoint.stage_at';

/** Reads the singleton checkpoint row left behind by whichever cycle wrote last. */
export const SYNC_CYCLE_CHECKPOINT_SELECT_SQL =
  'SELECT cycle_id, stage, stage_at, started_at, failed_checkpoint_count ' +
  'FROM sync_cycle_checkpoint WHERE id = 1';
