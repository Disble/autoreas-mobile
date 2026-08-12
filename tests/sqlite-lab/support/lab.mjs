/**
 * Shared support for the SQLite lab.
 *
 * The lab runs OUTSIDE jest on purpose: it needs real file-backed SQLite
 * connections and real OS-level lock contention, neither of which the
 * jest-expo environment can provide. Nothing here is imported by `src/`.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Production value from src/infrastructure/db/startup/startup.constants.ts. */
export const PRODUCTION_BUSY_TIMEOUT_MS = 5000;

/**
 * Creates an isolated temp directory + database path for one scenario.
 * Every scenario owns its own file so scenarios cannot contaminate each other.
 */
export function createLabFile(scenarioId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sqlite-lab-${scenarioId}-`));
  return {
    dir,
    file: path.join(dir, 'lab.db'),
    cleanup() {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          return;
        } catch {
          sleepSync(50);
        }
      }
    },
  };
}

/**
 * Opens a connection shaped like a production one.
 *
 * `busyTimeoutMs: null` models the connections expo-sqlite creates implicitly
 * (for example inside withExclusiveTransactionAsync), which receive no pragma
 * at all and therefore keep SQLite's default of 0.
 */
export function openConn(file, { busyTimeoutMs = PRODUCTION_BUSY_TIMEOUT_MS, wal = true } = {}) {
  const db = new DatabaseSync(file);
  // Pragma order matches production (startup.helpers.ts sets busy_timeout before
  // journal_mode); with the reverse order, opening under contention throws
  // SQLITE_BUSY_RECOVERY (261) before any timeout is in effect.
  if (busyTimeoutMs !== null) db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
  if (wal) db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

/** Creates the minimal chapter-counter schema the production bug touches. */
export function seed(db, rows = 5) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY,
      anime_id INTEGER NOT NULL,
      current INTEGER NOT NULL DEFAULT 0
    );
  `);
  const insert = db.prepare('INSERT OR IGNORE INTO chapters (id, anime_id, current) VALUES (?, ?, 0)');
  for (let id = 1; id <= rows; id += 1) insert.run(id, id);
}

/** Reads the effective busy_timeout of a connection, for evidence lines. */
export function readBusyTimeout(db) {
  return db.prepare('PRAGMA busy_timeout').get().timeout;
}

/** Normalizes a thrown SQLite error into a comparable record. */
export function describeError(error) {
  if (!error) return null;
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    errcode: error.errcode,
    errstr: error.errstr,
  };
}

/** A single string that captures the full identity of an error, for byte-identity checks. */
export function errorFingerprint(error) {
  const d = describeError(error);
  if (!d) return '<no error>';
  return `${d.name}|${d.message}|${d.code}|${d.errcode}|${d.errstr}`;
}

/** Runs `fn`, returning success/failure plus wall-clock milliseconds. */
export function timed(fn) {
  const start = process.hrtime.bigint();
  try {
    const value = fn();
    return { ok: true, ms: elapsedMs(start), value, error: null };
  } catch (error) {
    return { ok: false, ms: elapsedMs(start), value: undefined, error };
  }
}

function elapsedMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

/** Blocking sleep. The lab is synchronous by design, mirroring the sync driver. */
export function sleepSync(ms) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

/**
 * The exact production write shape: deferred BEGIN, SELECT, UPDATE, COMMIT.
 * Returns the outcome of each stage so a scenario can tell WHICH statement failed.
 */
export function productionWriteUnit(db, id = 1) {
  const stages = {};
  try {
    stages.begin = timed(() => db.exec('BEGIN'));
    if (!stages.begin.ok) throw stages.begin.error;

    stages.select = timed(() => db.prepare('SELECT current FROM chapters WHERE id = ?').get(id));
    if (!stages.select.ok) throw stages.select.error;

    const next = stages.select.value.current + 1;
    stages.update = timed(() =>
      db.prepare('UPDATE chapters SET current = ? WHERE id = ?').run(next, id),
    );
    if (!stages.update.ok) throw stages.update.error;

    stages.commit = timed(() => db.exec('COMMIT'));
    if (!stages.commit.ok) throw stages.commit.error;

    return { ok: true, failedStage: null, error: null, stages };
  } catch (error) {
    // Mirror what a transaction wrapper does: try to unwind so the connection stays usable.
    try {
      db.exec('ROLLBACK');
    } catch {
      /* no transaction to unwind */
    }
    const failedStage = ['begin', 'select', 'update', 'commit'].find((s) => stages[s] && !stages[s].ok);
    return { ok: false, failedStage: failedStage ?? 'unknown', error, stages };
  }
}

/** Locks a mutex backed by a SharedArrayBuffer — the cross-thread stand-in for a JS write queue. */
export function mutexLock(view, index = 0) {
  for (;;) {
    if (Atomics.compareExchange(view, index, 0, 1) === 0) return;
    Atomics.wait(view, index, 1);
  }
}

/** Releases the mutex and wakes one waiter. */
export function mutexUnlock(view, index = 0) {
  Atomics.store(view, index, 0);
  Atomics.notify(view, index, 1);
}

export const VERDICT = {
  CONFIRMED: 'CONFIRMED',
  FALSIFIED: 'FALSIFIED',
  NOT_FALSIFIABLE: 'NOT FALSIFIABLE HERE',
};

/** Prints one scenario result in standalone mode. */
export function printResult(result) {
  console.log(`\n=== ${result.id} — ${result.title} ===`);
  console.log(`PREDICTION: ${result.prediction}`);
  console.log(`OBSERVED  : ${result.observed}`);
  for (const line of result.evidence) console.log(`  · ${line}`);
  console.log(`VERDICT   : ${result.verdict}`);
}

/** Wires a scenario module so `node <file>` runs it on its own. */
export async function runStandalone(moduleUrl, run) {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
  const self = path.resolve(new URL(moduleUrl).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  if (invoked !== self) return;
  printResult(await run());
}
