/**
 * A writer actor for the concurrency scenarios. Each worker is a real OS thread
 * with its own connection, so the contention it creates is genuine SQLite
 * file-lock contention, not simulated interleaving.
 *
 * `useMutex` models the production write serializer: a single in-process queue
 * that guarantees no two write units overlap. `bypassMutex` models the call
 * sites that write directly, outside that queue.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { openConn, productionWriteUnit, errorFingerprint, mutexLock, mutexUnlock } from './lab.mjs';

const { file, iterations, busyTimeoutMs, useMutex, bypassMutex, mutex, start, rowId } = workerData;
const mutexView = new Int32Array(mutex);
const startView = new Int32Array(start);

// WAL is a persistent property of the file and the setup connection already set
// it. Production does the same: only the foreground connection declares it.
const db = openConn(file, { busyTimeoutMs, wal: false });
const serialize = useMutex && !bypassMutex;

// Start barrier: every worker begins hammering at the same moment.
while (Atomics.load(startView, 0) === 0) Atomics.wait(startView, 0, 0, 50);

const failures = new Map();
let succeeded = 0;
let failed = 0;

for (let i = 0; i < iterations; i += 1) {
  if (serialize) mutexLock(mutexView);
  try {
    const result = productionWriteUnit(db, rowId);
    if (result.ok) {
      succeeded += 1;
    } else {
      failed += 1;
      const key = `${result.failedStage}: ${errorFingerprint(result.error)}`;
      failures.set(key, (failures.get(key) ?? 0) + 1);
    }
  } finally {
    if (serialize) mutexUnlock(mutexView);
  }
}

db.close();
parentPort.postMessage({
  workerId: workerData.workerId,
  serialize,
  succeeded,
  failed,
  failures: [...failures.entries()],
});
