/**
 * Background actors for the full production-shape reproduction (H12).
 *
 *  ticker    — the 15s foreground sync ticker (compressed), busy_timeout=5000.
 *  exclusive — stands in for the connection expo-sqlite creates implicitly for
 *              withExclusiveTransactionAsync: NO busy_timeout pragma at all.
 *  leaker    — a write transaction that is opened and never unwound.
 */
import { workerData } from 'node:worker_threads';
import { openConn, productionWriteUnit, sleepSync } from './lab.mjs';

const { file, role, control, rowId, tickMs, holdMs } = workerData;
const view = new Int32Array(control);
const STOP = 0;
const READY = 1;

function stopped() {
  return Atomics.load(view, STOP) === 1;
}

if (role === 'ticker') {
  const db = openConn(file, { busyTimeoutMs: 5000, wal: false });
  while (!stopped()) {
    productionWriteUnit(db, rowId);
    sleepSync(tickMs);
  }
  db.close();
} else if (role === 'exclusive') {
  const db = openConn(file, { busyTimeoutMs: null, wal: false });
  while (!stopped()) {
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(rowId);
      sleepSync(holdMs);
      db.exec('COMMIT');
    } catch {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* nothing to unwind */
      }
    }
    sleepSync(tickMs);
  }
  db.close();
} else if (role === 'leaker') {
  const db = openConn(file, { busyTimeoutMs: 5000, wal: false });
  db.exec('BEGIN IMMEDIATE');
  db.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(rowId);
  Atomics.store(view, READY, 1);
  Atomics.notify(view, READY);
  while (!stopped()) sleepSync(25);
  // Closing without COMMIT is the "process restart" analogue: the OS reclaims
  // the connection and SQLite rolls the abandoned transaction back.
  db.close();
}
