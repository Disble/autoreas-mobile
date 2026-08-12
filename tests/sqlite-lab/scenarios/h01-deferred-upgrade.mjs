/**
 * H1 — A deferred read-then-write upgrade bypasses the busy handler.
 *
 * A (busy_timeout=5000) opens a deferred BEGIN and SELECTs, taking a WAL read
 * snapshot. B then commits a write, advancing the WAL past A's snapshot. A's
 * UPDATE must now upgrade the snapshot, which SQLite refuses without ever
 * consulting the busy handler.
 */
import { createLabFile, openConn, seed, timed, describeError, VERDICT, runStandalone, readBusyTimeout } from '../support/lab.mjs';

export const meta = {
  id: 'H1',
  title: 'Deferred read-then-write upgrade bypasses the busy handler',
  prediction: "A's UPDATE fails almost immediately (« 5000ms) with a database-is-locked-class error",
};

export async function run() {
  const lab = createLabFile('h01');
  const evidence = [];
  let a;
  let b;
  try {
    a = openConn(lab.file, { busyTimeoutMs: 5000 });
    seed(a);
    b = openConn(lab.file, { busyTimeoutMs: 5000 });
    evidence.push(`A busy_timeout=${readBusyTimeout(a)}ms, B busy_timeout=${readBusyTimeout(b)}ms, journal=wal`);

    a.exec('BEGIN');
    const readRow = a.prepare('SELECT current FROM chapters WHERE id = ?').get(1);
    evidence.push(`A: BEGIN (deferred) + SELECT ok -> current=${readRow.current} (read snapshot taken)`);

    const bWrite = timed(() => {
      b.exec('BEGIN IMMEDIATE');
      b.prepare('UPDATE chapters SET current = current + 10 WHERE id = ?').run(1);
      b.exec('COMMIT');
    });
    evidence.push(`B: committed a write in ${bWrite.ms.toFixed(2)}ms (ok=${bWrite.ok}) -> WAL advanced past A's snapshot`);

    const aUpdate = timed(() =>
      a.prepare('UPDATE chapters SET current = ? WHERE id = ?').run(readRow.current + 1, 1),
    );

    const err = describeError(aUpdate.error);
    evidence.push(`A: UPDATE outcome ok=${aUpdate.ok}, elapsed=${aUpdate.ms.toFixed(2)}ms`);
    if (err) {
      evidence.push(`A: error message=${JSON.stringify(err.message)} code=${err.code} errcode=${err.errcode} errstr=${JSON.stringify(err.errstr)}`);
      evidence.push(
        `A: errcode ${err.errcode} => ${err.errcode === 517 ? 'SQLITE_BUSY_SNAPSHOT (extended)' : err.errcode === 5 ? 'SQLITE_BUSY (primary; extended codes not surfaced)' : 'unexpected code'}`,
      );
    }

    try {
      a.exec('ROLLBACK');
    } catch {
      /* nothing to unwind */
    }

    const instant = !aUpdate.ok && aUpdate.ms < 500;
    const busyClass = err?.errcode === 5 || err?.errcode === 517;

    return {
      ...meta,
      observed: aUpdate.ok
        ? `A's UPDATE SUCCEEDED after ${aUpdate.ms.toFixed(2)}ms`
        : `A's UPDATE failed after ${aUpdate.ms.toFixed(2)}ms with "${err.message}" (errcode ${err.errcode})`,
      verdict: instant && busyClass ? VERDICT.CONFIRMED : VERDICT.FALSIFIED,
      evidence,
    };
  } finally {
    a?.close();
    b?.close();
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
