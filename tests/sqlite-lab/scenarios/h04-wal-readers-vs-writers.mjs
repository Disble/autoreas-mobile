/**
 * H4 — In WAL mode, a held write transaction blocks writers but not readers.
 * Candidate explanation for symptom S4 (the list still renders, only the
 * numbers are stale).
 */
import { createLabFile, openConn, seed, timed, describeError, VERDICT, runStandalone } from '../support/lab.mjs';

export const meta = {
  id: 'H4',
  title: 'In WAL, a held write transaction blocks writers but not readers',
  prediction: "B's SELECT succeeds; B's UPDATE fails",
};

export async function run() {
  const lab = createLabFile('h04');
  const evidence = [];
  let a;
  let b;
  try {
    a = openConn(lab.file, { busyTimeoutMs: 5000 });
    seed(a);
    b = openConn(lab.file, { busyTimeoutMs: null });

    a.exec('BEGIN IMMEDIATE');
    a.prepare('UPDATE chapters SET current = 999 WHERE id = ?').run(1);
    evidence.push('A: BEGIN IMMEDIATE + UPDATE, transaction left OPEN (uncommitted)');

    const bSelect = timed(() => b.prepare('SELECT id, current FROM chapters ORDER BY id').all());
    evidence.push(
      `B: SELECT ok=${bSelect.ok}, elapsed=${bSelect.ms.toFixed(2)}ms, rows=${bSelect.value?.length}, id1.current=${bSelect.value?.[0]?.current} (A's uncommitted 999 is correctly invisible)`,
    );

    const bUpdate = timed(() => b.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2));
    const bErr = describeError(bUpdate.error);
    evidence.push(
      `B: UPDATE ok=${bUpdate.ok}, elapsed=${bUpdate.ms.toFixed(2)}ms, error=${JSON.stringify(bErr?.message)} errcode=${bErr?.errcode}`,
    );

    a.exec('ROLLBACK');

    const readWorks = bSelect.ok;
    const writeBlocked = !bUpdate.ok;

    return {
      ...meta,
      observed: `B's SELECT succeeded (${bSelect.value?.length} rows, stale values); B's UPDATE failed with "${bErr?.message}"`,
      verdict: readWorks && writeBlocked ? VERDICT.CONFIRMED : VERDICT.FALSIFIED,
      evidence,
    };
  } finally {
    a?.close();
    b?.close();
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
