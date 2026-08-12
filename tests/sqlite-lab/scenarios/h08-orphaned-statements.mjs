/**
 * H8 — Does an orphaned / unreset prepared statement keep a transaction open
 * that blocks other WRITERS?
 *
 *  (a) an unreset, partially-stepped SELECT on A  -> can B write?
 *  (b) an UPDATE stepped but not reset on A       -> can B write?
 *
 * This adjudicates the specific claim that leaked unfinalized statements
 * explain S3/S6. If (a) does not block writers, that claim survives only
 * through (b).
 */
import { createLabFile, openConn, seed, timed, describeError, VERDICT, runStandalone } from '../support/lab.mjs';

export const meta = {
  id: 'H8',
  title: 'Orphaned prepared statements: which kind blocks other writers',
  prediction: '(a) a lingering READER does NOT block B\'s write; (b) a lingering WRITER does block it',
};

function subCaseA(file, evidence) {
  const a = openConn(file, { busyTimeoutMs: 5000 });
  const b = openConn(file, { busyTimeoutMs: null });
  try {
    const stmt = a.prepare('SELECT id, current FROM chapters ORDER BY id');
    const iterator = stmt.iterate();
    const first = iterator.next();
    evidence.push(`(a) A: SELECT stepped once via iterate() -> row=${JSON.stringify(first.value)}; read transaction implicitly OPEN`);

    const bWrite = timed(() => b.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2));
    evidence.push(
      `(a) B: UPDATE ok=${bWrite.ok}, elapsed=${bWrite.ms.toFixed(2)}ms, error=${JSON.stringify(describeError(bWrite.error)?.message)} errcode=${describeError(bWrite.error)?.errcode}`,
    );

    // A second write proves the first was not a fluke of WAL frame placement.
    const bWrite2 = timed(() => b.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(3));
    evidence.push(`(a) B: second UPDATE ok=${bWrite2.ok}, elapsed=${bWrite2.ms.toFixed(2)}ms`);

    iterator.return?.();
    return { blocked: !bWrite.ok, ms: bWrite.ms, error: describeError(bWrite.error) };
  } finally {
    a.close();
    b.close();
  }
}

function subCaseB(file, evidence) {
  const a = openConn(file, { busyTimeoutMs: 5000 });
  const b = openConn(file, { busyTimeoutMs: null });
  try {
    // RETURNING makes the UPDATE row-producing, so iterate() can leave it
    // stepped-but-not-reset — the only way to construct this state here.
    const stmt = a.prepare('UPDATE chapters SET current = current + 1 WHERE id IN (1,2,3,4,5) RETURNING id');
    const iterator = stmt.iterate();
    const first = iterator.next();
    evidence.push(
      `(b) A: UPDATE...RETURNING stepped once via iterate() -> row=${JSON.stringify(first.value)}; implicit WRITE transaction OPEN, statement not reset`,
    );

    const bWrite = timed(() => b.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2));
    evidence.push(
      `(b) B: UPDATE ok=${bWrite.ok}, elapsed=${bWrite.ms.toFixed(2)}ms, error=${JSON.stringify(describeError(bWrite.error)?.message)} errcode=${describeError(bWrite.error)?.errcode}`,
    );

    iterator.return?.();
    const bAfter = timed(() => b.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2));
    evidence.push(
      `(b) after A's iterator is closed (statement reset/finalized): B UPDATE ok=${bAfter.ok}, elapsed=${bAfter.ms.toFixed(2)}ms`,
    );

    return { blocked: !bWrite.ok, ms: bWrite.ms, error: describeError(bWrite.error), releasedAfterReset: bAfter.ok };
  } finally {
    a.close();
    b.close();
  }
}

export async function run() {
  const lab = createLabFile('h08');
  const evidence = [];
  try {
    const setup = openConn(lab.file);
    seed(setup, 20);
    setup.close();

    const a = subCaseA(lab.file, evidence);
    const b = subCaseB(lab.file, evidence);

    const asPredicted = !a.blocked && b.blocked;
    evidence.push(
      asPredicted
        ? '=> a lingering READER does not block writers; only a lingering WRITER does. The WAL reader/writer model holds.'
        : '=> the WAL reader/writer model did NOT hold as stated — see the sub-case results above.',
    );

    return {
      ...meta,
      observed: `(a) lingering reader: B's write ${a.blocked ? `BLOCKED ("${a.error?.message}")` : `SUCCEEDED in ${a.ms.toFixed(2)}ms`}; (b) lingering writer: B's write ${b.blocked ? `BLOCKED ("${b.error?.message}", errcode ${b.error?.errcode})` : 'SUCCEEDED'}${b.releasedAfterReset ? ', released once the statement was reset' : ''}`,
      verdict: asPredicted ? VERDICT.CONFIRMED : VERDICT.FALSIFIED,
      evidence,
    };
  } finally {
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
