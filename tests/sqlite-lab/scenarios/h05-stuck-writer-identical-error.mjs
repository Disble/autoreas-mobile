/**
 * H5 — A connection stuck inside an open write transaction blocks every other
 * writer indefinitely, with a byte-identical error each time.
 * Candidate explanation for symptoms S3 (always the same message) and S6
 * (persists until the process restarts).
 */
import { createLabFile, openConn, seed, timed, errorFingerprint, sleepSync, VERDICT, runStandalone } from '../support/lab.mjs';

export const meta = {
  id: 'H5',
  title: 'A stuck write transaction blocks every other writer with an identical error',
  prediction: 'all 5 attempts fail and all 5 error fingerprints are byte-identical',
};

export async function run() {
  const lab = createLabFile('h05');
  const evidence = [];
  let a;
  let b;
  try {
    a = openConn(lab.file, { busyTimeoutMs: 5000 });
    seed(a);
    b = openConn(lab.file, { busyTimeoutMs: null });

    a.exec('BEGIN IMMEDIATE');
    a.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(1);
    evidence.push('A: BEGIN IMMEDIATE + UPDATE, never committed or rolled back');

    const fingerprints = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = timed(() => b.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2));
      const fp = errorFingerprint(result.error);
      fingerprints.push(fp);
      evidence.push(
        `attempt ${attempt} (t+${attempt - 1}s): ok=${result.ok}, elapsed=${result.ms.toFixed(2)}ms, fingerprint=${fp}`,
      );
      if (attempt < 5) sleepSync(1000);
    }

    a.exec('ROLLBACK');

    const allFailed = fingerprints.every((fp) => fp !== '<no error>');
    const allIdentical = new Set(fingerprints).size === 1;
    evidence.push(`distinct fingerprints across 5 attempts spanning ~4s: ${new Set(fingerprints).size}`);

    return {
      ...meta,
      observed: allFailed
        ? `all 5 attempts failed; ${allIdentical ? 'all 5 fingerprints byte-identical' : 'fingerprints DIFFERED'} -> ${fingerprints[0]}`
        : 'at least one attempt succeeded',
      verdict: allFailed && allIdentical ? VERDICT.CONFIRMED : VERDICT.FALSIFIED,
      evidence,
    };
  } finally {
    a?.close();
    b?.close();
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
