/**
 * H2 — A connection with no busy_timeout fails instantly under contention;
 * one with busy_timeout=5000 waits.
 *
 * The contention is created by a holder that keeps a write transaction open and
 * never releases it. The contender uses BEGIN IMMEDIATE so the busy handler is
 * actually reachable (see H1 for what happens when it is not).
 */
import { createLabFile, openConn, seed, timed, describeError, VERDICT, runStandalone } from '../support/lab.mjs';

export const meta = {
  id: 'H2',
  title: 'No busy_timeout fails instantly; busy_timeout=5000 waits',
  prediction: 'zero-pragma connection fails in ~0ms; the 5000ms connection blocks measurably longer',
};

function contend(file, busyTimeoutMs) {
  const holder = openConn(file, { busyTimeoutMs: 5000 });
  const contender = openConn(file, { busyTimeoutMs });
  try {
    holder.exec('BEGIN IMMEDIATE');
    holder.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(1);
    const attempt = timed(() => {
      contender.exec('BEGIN IMMEDIATE');
      contender.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2);
      contender.exec('COMMIT');
    });
    try {
      contender.exec('ROLLBACK');
    } catch {
      /* nothing to unwind */
    }
    holder.exec('ROLLBACK');
    return attempt;
  } finally {
    holder.close();
    contender.close();
  }
}

export async function run() {
  const lab = createLabFile('h02');
  const evidence = [];
  try {
    const setup = openConn(lab.file);
    seed(setup);
    setup.close();

    const noPragma = contend(lab.file, null);
    const withPragma = contend(lab.file, 5000);

    const noPragmaErr = describeError(noPragma.error);
    const withPragmaErr = describeError(withPragma.error);

    evidence.push(
      `no-pragma (busy_timeout=0): ok=${noPragma.ok}, elapsed=${noPragma.ms.toFixed(2)}ms, error=${JSON.stringify(noPragmaErr?.message)} errcode=${noPragmaErr?.errcode}`,
    );
    evidence.push(
      `busy_timeout=5000    : ok=${withPragma.ok}, elapsed=${withPragma.ms.toFixed(2)}ms, error=${JSON.stringify(withPragmaErr?.message)} errcode=${withPragmaErr?.errcode}`,
    );
    evidence.push(`delta = ${(withPragma.ms - noPragma.ms).toFixed(2)}ms`);

    const fastFail = !noPragma.ok && noPragma.ms < 100;
    const slowFail = !withPragma.ok && withPragma.ms > 4000;

    return {
      ...meta,
      observed: `no-pragma failed in ${noPragma.ms.toFixed(2)}ms; busy_timeout=5000 failed in ${withPragma.ms.toFixed(2)}ms`,
      verdict: fastFail && slowFail ? VERDICT.CONFIRMED : VERDICT.FALSIFIED,
      evidence,
    };
  } finally {
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
