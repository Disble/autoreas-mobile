/**
 * H14 — A failed close attempt, retried against the SAME still-open handle, eventually
 * releases the lock. Extends H6: proves the "keep the handle across a failed close so it
 * can be retried" contract Slice B adds to
 * `src/features/sync/sqlite-sync-runtime.helpers.ts`'s `close()`.
 *
 * `node:sqlite`'s own `close()` essentially never fails (H7 falsified "SQLite refuses to
 * close with unfinalized statements"), so this arm cannot observe SQLite ITSELF failing to
 * close. What it proves instead: the retry contract works end-to-end against a REAL SQLite
 * lock. A first close attempt is rejected purely at the JS wrapper layer (mirroring how
 * expo-sqlite's `closeAsync`/`closeSync` can each reject independently of the underlying
 * connection) -- the connection is left open and the lock held, exactly like the pre-Slice-B
 * bug except the reference is NOT dropped. Retrying against that SAME still-open handle then
 * succeeds, and only then does the lock actually release.
 */
import {
  createLabFile,
  openConn,
  seed,
  timed,
  describeError,
  VERDICT,
  runStandalone,
} from '../support/lab.mjs';

export const meta = {
  id: 'H14',
  title: 'A failed close attempt, retried against the same still-open handle, eventually releases the lock',
  prediction:
    "B's write fails while A holds the lock; a first close attempt is rejected without touching the connection so B still fails; a retry against the SAME handle succeeds and B's write then succeeds",
};

/**
 * Models the production close() contract: a close attempt can reject at the JS/native
 * binding layer WITHOUT the underlying connection state changing (see
 * `closeSyncRuntime` -- `closeAsync`/`closeSync` can each throw independently). Fails
 * exactly once before delegating to the real, synchronous `node:sqlite` close().
 */
function createRetriableClose(conn) {
  let attempts = 0;
  return function attemptClose() {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('simulated native close rejection');
    }
    conn.close();
  };
}

export async function run() {
  const lab = createLabFile('h14');
  const evidence = [];
  let a;
  let b;
  try {
    a = openConn(lab.file, { busyTimeoutMs: 5000 });
    seed(a);
    b = openConn(lab.file, { busyTimeoutMs: null });

    a.exec('BEGIN IMMEDIATE');
    a.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(1);

    const beforeAnyClose = timed(() =>
      b.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2),
    );
    evidence.push(
      `before any close attempt: B write ok=${beforeAnyClose.ok}, error=${JSON.stringify(describeError(beforeAnyClose.error)?.message)}`,
    );

    const attemptClose = createRetriableClose(a);

    const firstAttempt = timed(() => attemptClose());
    evidence.push(
      `close attempt 1: ok=${firstAttempt.ok} (simulated rejection) -- per Decision 6, the caller keeps its reference to A instead of dropping it`,
    );

    // A is still reachable -- exactly what Decision 6 guarantees. Prove it by reusing the
    // still-open lock's effect, the same way a real caller's retry reuses `runtime.rawDb`.
    const stillOpenWrite = timed(() =>
      b.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2),
    );
    evidence.push(
      `after failed attempt 1, before retry: B write ok=${stillOpenWrite.ok} -- the lock is still held because A was never dropped`,
    );

    const secondAttempt = timed(() => attemptClose());
    evidence.push(`close attempt 2 (retry against the SAME handle): ok=${secondAttempt.ok}`);
    a = null;

    const afterClose = timed(() =>
      b.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2),
    );
    evidence.push(
      `after the retried close succeeds: B write ok=${afterClose.ok}, elapsed=${afterClose.ms.toFixed(2)}ms`,
    );

    const verified = b.prepare('SELECT current FROM chapters WHERE id = ?').get(2);
    evidence.push(`post-recovery read: chapters(id=2).current=${verified.current}`);

    const proved =
      !beforeAnyClose.ok &&
      !firstAttempt.ok &&
      !stillOpenWrite.ok &&
      secondAttempt.ok &&
      afterClose.ok;

    return {
      ...meta,
      observed: `B failed while A held the lock; close attempt 1 was rejected (A kept open, per Decision 6); B still failed against the still-open A; close attempt 2 (retry) succeeded; B then succeeded`,
      verdict: proved ? VERDICT.CONFIRMED : VERDICT.FALSIFIED,
      evidence,
    };
  } finally {
    a?.close();
    b?.close();
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
