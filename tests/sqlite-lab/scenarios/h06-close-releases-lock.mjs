/**
 * H6 — Closing the stuck connection releases the lock. (Tests a PROPOSED FIX:
 * teardown as a legitimate recovery path.)
 * Continues directly from H5's state.
 */
import { createLabFile, openConn, seed, timed, describeError, VERDICT, runStandalone } from '../support/lab.mjs';

export const meta = {
  id: 'H6',
  title: 'Closing the stuck connection releases the lock (proposed fix)',
  prediction: "B's write succeeds once A is closed",
};

export async function run() {
  const lab = createLabFile('h06');
  const evidence = [];
  let a;
  let b;
  try {
    a = openConn(lab.file, { busyTimeoutMs: 5000 });
    seed(a);
    b = openConn(lab.file, { busyTimeoutMs: null });

    a.exec('BEGIN IMMEDIATE');
    a.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(1);

    const before = timed(() => b.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2));
    evidence.push(
      `before close: B write ok=${before.ok}, elapsed=${before.ms.toFixed(2)}ms, error=${JSON.stringify(describeError(before.error)?.message)} errcode=${describeError(before.error)?.errcode}`,
    );

    const closed = timed(() => a.close());
    a = null;
    evidence.push(
      `A.close(): ok=${closed.ok}, elapsed=${closed.ms.toFixed(2)}ms, error=${JSON.stringify(describeError(closed.error)?.message)} (an uncommitted transaction is rolled back by close)`,
    );

    const after = timed(() => b.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2));
    evidence.push(
      `after close : B write ok=${after.ok}, elapsed=${after.ms.toFixed(2)}ms, error=${JSON.stringify(describeError(after.error)?.message)}`,
    );

    const verified = b.prepare('SELECT current FROM chapters WHERE id = ?').get(2);
    evidence.push(`post-recovery read: chapters(id=2).current=${verified.current}`);

    return {
      ...meta,
      observed: `before close B failed ("${describeError(before.error)?.message}"); A.close() ${closed.ok ? 'succeeded' : 'THREW'}; after close B write ok=${after.ok}`,
      verdict: !before.ok && closed.ok && after.ok ? VERDICT.CONFIRMED : VERDICT.FALSIFIED,
      evidence,
    };
  } finally {
    a?.close();
    b?.close();
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
