/**
 * H9 — Serializing every writer through one queue eliminates the contention.
 * (Tests a PROPOSED FIX.)
 *
 * Includes a NEGATIVE CONTROL arm with the serializer removed. Without it,
 * "zero errors" would prove nothing: it could just mean the workload never
 * contended in the first place.
 */
import { createLabFile, openConn, seed, VERDICT, runStandalone } from '../support/lab.mjs';
import { runWriterFleet } from '../support/concurrency.mjs';

export const meta = {
  id: 'H9',
  title: 'Serializing every writer through one queue eliminates contention (proposed fix)',
  prediction: 'zero "database is locked" errors across many iterations, while the unserialized control arm still produces them',
};

const ITERATIONS = 250;
const WRITERS = 4;

export async function run() {
  const lab = createLabFile('h09');
  const evidence = [];
  try {
    const setup = openConn(lab.file);
    seed(setup);
    setup.close();

    const control = await runWriterFleet(
      lab.file,
      Array.from({ length: WRITERS }, () => ({ busyTimeoutMs: 5000, useMutex: false })),
      { iterations: ITERATIONS },
    );
    evidence.push(
      `CONTROL (no serializer, ${WRITERS} threads x ${ITERATIONS} production write units, all busy_timeout=5000): attempts=${control.attempts}, succeeded=${control.succeeded}, failed=${control.failed}`,
    );
    for (const [key, count] of control.failures) evidence.push(`  control failure x${count}: ${key}`);

    const serialized = await runWriterFleet(
      lab.file,
      Array.from({ length: WRITERS }, () => ({ busyTimeoutMs: 5000, useMutex: true })),
      { iterations: ITERATIONS },
    );
    evidence.push(
      `SERIALIZED (single write queue, same workload): attempts=${serialized.attempts}, succeeded=${serialized.succeeded}, failed=${serialized.failed}`,
    );
    for (const [key, count] of serialized.failures) evidence.push(`  serialized failure x${count}: ${key}`);

    const controlContended = control.failed > 0;
    const serializerClean = serialized.failed === 0;

    return {
      ...meta,
      observed: `control produced ${control.failed}/${control.attempts} failures; serialized produced ${serialized.failed}/${serialized.attempts}`,
      verdict: controlContended && serializerClean ? VERDICT.CONFIRMED : VERDICT.FALSIFIED,
      evidence,
    };
  } finally {
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
