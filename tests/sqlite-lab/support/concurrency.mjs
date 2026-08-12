/** Shared driver for the multi-threaded contention scenarios (H9, H10). */
import { Worker } from 'node:worker_threads';

/**
 * Runs `workers.length` writer threads against one database file and aggregates
 * their outcomes. Each entry of `workers` describes one actor.
 */
export async function runWriterFleet(file, workers, { iterations, rowId = 1 }) {
  const mutex = new SharedArrayBuffer(4);
  const start = new SharedArrayBuffer(4);
  const startView = new Int32Array(start);

  const results = [];
  const threads = workers.map(
    (spec, index) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./worker-writer.mjs', import.meta.url), {
          workerData: { file, iterations, mutex, start, rowId, workerId: index, ...spec },
        });
        worker.on('message', (message) => {
          results.push(message);
          resolve(message);
        });
        worker.on('error', reject);
      }),
  );

  // Release the barrier once every thread has had a moment to open its connection.
  setTimeout(() => {
    Atomics.store(startView, 0, 1);
    Atomics.notify(startView, 0);
  }, 100);

  const startedAt = process.hrtime.bigint();
  await Promise.all(threads);
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  return { ...summarize(results), durationMs };
}

function summarize(results) {
  const failures = new Map();
  let succeeded = 0;
  let failed = 0;
  for (const r of results) {
    succeeded += r.succeeded;
    failed += r.failed;
    for (const [key, count] of r.failures) failures.set(key, (failures.get(key) ?? 0) + count);
  }
  return { perWorker: results, succeeded, failed, attempts: succeeded + failed, failures: [...failures.entries()] };
}
