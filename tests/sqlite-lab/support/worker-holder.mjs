/**
 * Worker that grabs the WAL write lock, signals the main thread, holds the lock
 * for `holdMs`, then commits. Used where a scenario needs the lock released
 * WHILE the main thread is blocked inside a synchronous SQLite call.
 */
import { workerData } from 'node:worker_threads';
import { openConn, sleepSync } from './lab.mjs';

const { file, holdMs, signal } = workerData;
const view = new Int32Array(signal);

const db = openConn(file, { busyTimeoutMs: 5000 });
db.exec('BEGIN IMMEDIATE');
db.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(1);

// Tell the main thread the write lock is held.
Atomics.store(view, 0, 1);
Atomics.notify(view, 0);

sleepSync(holdMs);
db.exec('COMMIT');
db.close();
