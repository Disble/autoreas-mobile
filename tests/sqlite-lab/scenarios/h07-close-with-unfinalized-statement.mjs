/**
 * H7 — SQLite refuses to close a connection that has unfinalized prepared
 * statements.
 *
 * Under node:sqlite the only way to leave a statement mid-step is `iterate()`
 * without exhausting the iterator, so that is what this scenario constructs.
 */
import { createLabFile, openConn, seed, timed, describeError, VERDICT, runStandalone } from '../support/lab.mjs';

export const meta = {
  id: 'H7',
  title: 'SQLite refuses to close a connection with unfinalized prepared statements',
  prediction: 'the close fails or is deferred (sqlite3_close returns SQLITE_BUSY)',
};

export async function run() {
  const lab = createLabFile('h07');
  const evidence = [];
  let a;
  try {
    a = openConn(lab.file, { busyTimeoutMs: 5000 });
    seed(a, 50);

    const stmt = a.prepare('SELECT id, current FROM chapters ORDER BY id');
    const iterator = stmt.iterate();
    const first = iterator.next();
    evidence.push(
      `A: prepared SELECT and stepped ONCE via iterate() -> row=${JSON.stringify(first.value)}, done=${first.done}; statement is mid-step, not reset, not finalized`,
    );

    const closed = timed(() => a.close());
    const err = describeError(closed.error);
    evidence.push(
      `A.close(): ok=${closed.ok}, elapsed=${closed.ms.toFixed(2)}ms, error=${JSON.stringify(err?.message)} code=${err?.code} errcode=${err?.errcode}`,
    );

    if (closed.ok) {
      a = null;
      const afterUse = timed(() => iterator.next());
      evidence.push(
        `post-close iterator.next(): ok=${afterUse.ok}, error=${JSON.stringify(describeError(afterUse.error)?.message)} -> node:sqlite finalized the statement as part of close()`,
      );
    }

    evidence.push(
      'SCOPE: this falsifies the prediction for the node:sqlite API surface, which finalizes outstanding statements before closing. It does NOT prove what raw sqlite3_close() would return, nor what expo-sqlite does — a binding that calls sqlite3_close() (not _v2) without finalizing first could still see SQLITE_BUSY.',
    );

    return {
      ...meta,
      observed: closed.ok
        ? `close() SUCCEEDED cleanly in ${closed.ms.toFixed(2)}ms despite a mid-step, unfinalized statement`
        : `close() FAILED with "${err?.message}" (errcode ${err?.errcode})`,
      verdict: closed.ok ? VERDICT.FALSIFIED : VERDICT.CONFIRMED,
      evidence,
    };
  } finally {
    try {
      a?.close();
    } catch {
      /* already closed */
    }
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
