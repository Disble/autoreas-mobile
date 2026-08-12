/**
 * H10 — A single writer that bypasses the serializer reintroduces the failure.
 *
 * This is the production reality: several call sites write via direct runAsync
 * outside the queue, so the queue's mutual exclusion is not total.
 */
import { createLabFile, openConn, seed, VERDICT, runStandalone } from '../support/lab.mjs';
import { runWriterFleet } from '../support/concurrency.mjs';

export const meta = {
  id: 'H10',
  title: 'One writer bypassing the serializer reintroduces the failure',
  prediction: 'BUSY returns as soon as a single writer writes outside the queue',
};

const ITERATIONS = 250;
const WRITERS = 4;

export async function run() {
  const lab = createLabFile('h10');
  const evidence = [];
  try {
    const setup = openConn(lab.file);
    seed(setup);
    setup.close();

    const specs = Array.from({ length: WRITERS }, (_unused, index) => ({
      busyTimeoutMs: 5000,
      useMutex: true,
      bypassMutex: index === 0,
    }));

    const result = await runWriterFleet(lab.file, specs, { iterations: ITERATIONS });
    evidence.push(
      `${WRITERS} threads x ${ITERATIONS} production write units; worker 0 BYPASSES the queue, workers 1-${WRITERS - 1} use it`,
    );
    evidence.push(`aggregate: attempts=${result.attempts}, succeeded=${result.succeeded}, failed=${result.failed}`);
    for (const worker of result.perWorker) {
      evidence.push(
        `  worker ${worker.workerId} (${worker.serialize ? 'queued' : 'BYPASS'}): succeeded=${worker.succeeded}, failed=${worker.failed}`,
      );
    }
    for (const [key, count] of result.failures) evidence.push(`  failure x${count}: ${key}`);

    return {
      ...meta,
      observed:
        result.failed > 0
          ? `${result.failed}/${result.attempts} write units failed even though 3 of 4 writers were fully serialized`
          : `no failures across ${result.attempts} attempts`,
      verdict: result.failed > 0 ? VERDICT.CONFIRMED : VERDICT.FALSIFIED,
      evidence,
    };
  } finally {
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
