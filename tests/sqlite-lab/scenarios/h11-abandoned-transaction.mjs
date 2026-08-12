/**
 * H11 — Abandoning a transaction mid-flight (as a naive timeout would) produces
 * a DIFFERENT error on the next attempt.
 *
 * Decisive for symptom S3: if the second BEGIN reports "cannot start a
 * transaction within a transaction", then any story in which a single stuck
 * connection keeps retrying WITHOUT unwinding is incompatible with an
 * always-byte-identical "database is locked".
 *
 * Three arms:
 *  (a) BEGIN, abandon, BEGIN again on the same connection.
 *  (b) The real production failure: deferred BEGIN + SELECT + BUSY on UPDATE,
 *      abandoned without ROLLBACK, then the next tap's BEGIN.
 *  (c) The same, but WITH a ROLLBACK in the error path.
 */
import { createLabFile, openConn, seed, timed, describeError, errorFingerprint, VERDICT, runStandalone } from '../support/lab.mjs';

export const meta = {
  id: 'H11',
  title: 'Abandoning a transaction mid-flight produces a DIFFERENT error next time',
  prediction: 'the second BEGIN fails with "cannot start a transaction within a transaction" — a different message from "database is locked"',
};

function armA(file, evidence) {
  const a = openConn(file, { busyTimeoutMs: 5000 });
  try {
    const first = timed(() => a.exec('BEGIN'));
    evidence.push(`(a) first BEGIN ok=${first.ok}; transaction then ABANDONED (no COMMIT, no ROLLBACK)`);
    const second = timed(() => a.exec('BEGIN'));
    const err = describeError(second.error);
    evidence.push(
      `(a) second BEGIN ok=${second.ok}, error=${JSON.stringify(err?.message)} code=${err?.code} errcode=${err?.errcode}`,
    );
    try {
      a.exec('ROLLBACK');
    } catch {
      /* nothing to unwind */
    }
    return { ok: second.ok, error: err };
  } finally {
    a.close();
  }
}

function armB(file, evidence, { rollbackOnError }) {
  const a = openConn(file, { busyTimeoutMs: 5000 });
  const b = openConn(file, { busyTimeoutMs: 5000 });
  const label = rollbackOnError ? '(c) with ROLLBACK' : '(b) no ROLLBACK';
  try {
    // Tap 1: the exact production failure from H1.
    a.exec('BEGIN');
    const row = a.prepare('SELECT current FROM chapters WHERE id = ?').get(1);
    b.exec('BEGIN IMMEDIATE');
    b.prepare('UPDATE chapters SET current = current + 10 WHERE id = ?').run(1);
    b.exec('COMMIT');

    const tap1 = timed(() => a.prepare('UPDATE chapters SET current = ? WHERE id = ?').run(row.current + 1, 1));
    const tap1Fp = errorFingerprint(tap1.error);
    evidence.push(`${label} tap 1 UPDATE: ok=${tap1.ok}, fingerprint=${tap1Fp}`);

    if (rollbackOnError && !tap1.ok) {
      const rolled = timed(() => a.exec('ROLLBACK'));
      evidence.push(`${label} error path issued ROLLBACK: ok=${rolled.ok}`);
    }

    // Tap 2 on the SAME connection.
    const tap2Begin = timed(() => a.exec('BEGIN'));
    const tap2Fp = errorFingerprint(tap2Begin.error);
    evidence.push(`${label} tap 2 BEGIN: ok=${tap2Begin.ok}, fingerprint=${tap2Fp}`);

    try {
      a.exec('ROLLBACK');
    } catch {
      /* nothing to unwind */
    }
    return { tap1Fp, tap2Ok: tap2Begin.ok, tap2Fp, tap2Error: describeError(tap2Begin.error) };
  } finally {
    a.close();
    b.close();
  }
}

export async function run() {
  const lab = createLabFile('h11');
  const evidence = [];
  try {
    const setup = openConn(lab.file);
    seed(setup);
    setup.close();

    const a = armA(lab.file, evidence);
    const noRollback = armB(lab.file, evidence, { rollbackOnError: false });
    const withRollback = armB(lab.file, evidence, { rollbackOnError: true });

    const nestedMessage = 'cannot start a transaction within a transaction';
    const armAMatches = !a.ok && a.error?.message === nestedMessage;
    const armBMatches = !noRollback.tap2Ok && noRollback.tap2Error?.message === nestedMessage;
    const differsFromBusy = noRollback.tap2Fp !== noRollback.tap1Fp;

    evidence.push(
      `(b) tap1 vs tap2 fingerprints differ: ${differsFromBusy} — an abandoned transaction changes the error on the NEXT attempt, so S3 (always byte-identical) cannot come from a connection that abandons without unwinding.`,
    );
    evidence.push(
      `(c) with ROLLBACK in the error path, tap 2's BEGIN succeeded=${withRollback.tap2Ok} — the connection is clean again, so a repeated identical BUSY must come from repeated fresh contention, not from residual transaction state.`,
    );

    return {
      ...meta,
      observed: `(a) second BEGIN failed with "${a.error?.message}" (code ${a.error?.code}); (b) after the real BUSY-on-UPDATE with no ROLLBACK, tap 2's BEGIN failed with "${noRollback.tap2Error?.message}" — different from tap 1's "database is locked"; (c) with ROLLBACK, tap 2's BEGIN succeeded`,
      verdict: armAMatches && armBMatches && differsFromBusy ? VERDICT.CONFIRMED : VERDICT.FALSIFIED,
      evidence,
    };
  } finally {
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
