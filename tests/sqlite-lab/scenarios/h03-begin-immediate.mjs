/**
 * H3 — BEGIN IMMEDIATE lets busy_timeout actually work. (Tests a PROPOSED FIX.)
 *
 * Three arms:
 *  (a) H1's exact sequence, but A opens with BEGIN IMMEDIATE. A must never hit
 *      a snapshot-upgrade failure.
 *  (b) Contention AT BEGIN IMMEDIATE time with a holder that releases after
 *      500ms: the busy handler must engage and A must then SUCCEED.
 *  (c) Same, but the holder never releases: A must fail only after ~busy_timeout.
 */
import { Worker } from 'node:worker_threads';
import { createLabFile, openConn, seed, timed, describeError, VERDICT, runStandalone } from '../support/lab.mjs';

export const meta = {
  id: 'H3',
  title: 'BEGIN IMMEDIATE lets busy_timeout actually work (proposed fix)',
  prediction: 'no instant snapshot failure; the busy handler engages, so A waits then succeeds, or fails only after ~busy_timeout',
};

function armA(file, evidence) {
  const a = openConn(file, { busyTimeoutMs: 5000 });
  const b = openConn(file, { busyTimeoutMs: 5000 });
  try {
    a.exec('BEGIN IMMEDIATE');
    const row = a.prepare('SELECT current FROM chapters WHERE id = ?').get(1);

    const bWrite = timed(() => {
      b.exec('BEGIN IMMEDIATE');
      b.prepare('UPDATE chapters SET current = current + 10 WHERE id = ?').run(1);
      b.exec('COMMIT');
    });
    try {
      b.exec('ROLLBACK');
    } catch {
      /* nothing to unwind */
    }
    evidence.push(
      `(a) B's competing write while A holds IMMEDIATE: ok=${bWrite.ok}, elapsed=${bWrite.ms.toFixed(2)}ms, error=${JSON.stringify(describeError(bWrite.error)?.message)} errcode=${describeError(bWrite.error)?.errcode}`,
    );

    const aUpdate = timed(() =>
      a.prepare('UPDATE chapters SET current = ? WHERE id = ?').run(row.current + 1, 1),
    );
    const aCommit = timed(() => a.exec('COMMIT'));
    evidence.push(
      `(a) A's UPDATE: ok=${aUpdate.ok}, elapsed=${aUpdate.ms.toFixed(2)}ms, error=${JSON.stringify(describeError(aUpdate.error)?.message)}; COMMIT ok=${aCommit.ok}`,
    );
    return { updateOk: aUpdate.ok, commitOk: aCommit.ok, updateMs: aUpdate.ms };
  } finally {
    try {
      a.exec('ROLLBACK');
    } catch {
      /* already committed */
    }
    a.close();
    b.close();
  }
}

async function armB(file, evidence) {
  const signal = new SharedArrayBuffer(4);
  const view = new Int32Array(signal);
  const worker = new Worker(new URL('../support/worker-holder.mjs', import.meta.url), {
    workerData: { file, holdMs: 500, signal },
  });
  // Block until the worker confirms it owns the write lock.
  while (Atomics.load(view, 0) === 0) Atomics.wait(view, 0, 0, 10);

  const a = openConn(file, { busyTimeoutMs: 5000 });
  const attempt = timed(() => {
    a.exec('BEGIN IMMEDIATE');
    a.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2);
    a.exec('COMMIT');
  });
  try {
    a.exec('ROLLBACK');
  } catch {
    /* nothing to unwind */
  }
  a.close();
  await new Promise((resolve) => worker.on('exit', resolve));

  evidence.push(
    `(b) holder releases after 500ms -> A BEGIN IMMEDIATE+write: ok=${attempt.ok}, elapsed=${attempt.ms.toFixed(2)}ms, error=${JSON.stringify(describeError(attempt.error)?.message)}`,
  );
  return attempt;
}

function armC(file, evidence) {
  const holder = openConn(file, { busyTimeoutMs: 5000 });
  const a = openConn(file, { busyTimeoutMs: 5000 });
  try {
    holder.exec('BEGIN IMMEDIATE');
    holder.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(1);
    const attempt = timed(() => {
      a.exec('BEGIN IMMEDIATE');
      a.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2);
      a.exec('COMMIT');
    });
    try {
      a.exec('ROLLBACK');
    } catch {
      /* nothing to unwind */
    }
    holder.exec('ROLLBACK');
    evidence.push(
      `(c) holder never releases -> A BEGIN IMMEDIATE: ok=${attempt.ok}, elapsed=${attempt.ms.toFixed(2)}ms, errcode=${describeError(attempt.error)?.errcode}`,
    );
    return attempt;
  } finally {
    holder.close();
    a.close();
  }
}

export async function run() {
  const lab = createLabFile('h03');
  const evidence = [];
  try {
    const setup = openConn(lab.file);
    seed(setup);
    setup.close();

    const a = armA(lab.file, evidence);
    const b = await armB(lab.file, evidence);
    const c = armC(lab.file, evidence);

    const noSnapshotFailure = a.updateOk && a.commitOk;
    const waitedThenSucceeded = b.ok && b.ms > 300;
    const failedOnlyAfterTimeout = !c.ok && c.ms > 4000;

    return {
      ...meta,
      observed: `(a) A's UPDATE succeeded in ${a.updateMs.toFixed(2)}ms with no snapshot failure; (b) A waited ${b.ms.toFixed(2)}ms and SUCCEEDED; (c) A failed only after ${c.ms.toFixed(2)}ms`,
      verdict: noSnapshotFailure && waitedThenSucceeded && failedOnlyAfterTimeout ? VERDICT.CONFIRMED : VERDICT.FALSIFIED,
      evidence,
    };
  } finally {
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
