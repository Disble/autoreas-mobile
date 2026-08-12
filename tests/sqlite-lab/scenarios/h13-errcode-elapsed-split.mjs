/**
 * H13 — `errcode` alone cannot distinguish an instant snapshot-upgrade rejection
 * from an exhausted busy-timeout wait; `elapsedMs` can.
 *
 * expo-sqlite never enables extended result codes (Slice A's Drift Register), so
 * every write failure the app can observe reduces to the SQLite PRIMARY errcode —
 * `5` for both SQLITE_BUSY and SQLITE_BUSY_SNAPSHOT. `node:sqlite` exposes the
 * EXTENDED code directly, so this scenario measures what expo throws away: arm A
 * reproduces H1's instant snapshot-upgrade rejection (extended 517), arm B
 * reproduces H2's exhausted busy_timeout wait (extended 5). Both reduce to the
 * SAME primary code once masked to a single byte the way Android's native binding
 * does it (`errcode & 0xff`) — only `elapsedMs` tells them apart.
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
  id: 'H13',
  title: 'errcode alone cannot split an instant snapshot rejection from an exhausted busy wait; elapsedMs can',
  prediction:
    'arm A fails in <500ms with extended errcode 517; arm B fails in ~5000ms with extended errcode 5; both mask to primary errcode 5, only elapsedMs separates them',
};

/** Arm A — H1's deferred read-then-write snapshot upgrade: instant, extended 517. */
function armSnapshotUpgrade(file) {
  const a = openConn(file, { busyTimeoutMs: 5000 });
  const b = openConn(file, { busyTimeoutMs: 5000 });
  try {
    a.exec('BEGIN');
    const row = a.prepare('SELECT current FROM chapters WHERE id = ?').get(1);

    b.exec('BEGIN IMMEDIATE');
    b.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(1);
    b.exec('COMMIT');

    const attempt = timed(() =>
      a.prepare('UPDATE chapters SET current = ? WHERE id = ?').run(row.current + 1, 1),
    );

    try {
      a.exec('ROLLBACK');
    } catch {
      /* nothing to unwind */
    }

    return attempt;
  } finally {
    a.close();
    b.close();
  }
}

/** Arm B — H2's exhausted busy_timeout: a holder that never releases, extended (== primary) 5. */
function armExhaustedTimeout(file) {
  const holder = openConn(file, { busyTimeoutMs: 5000 });
  const contender = openConn(file, { busyTimeoutMs: 5000 });
  try {
    holder.exec('BEGIN IMMEDIATE');
    holder.prepare('UPDATE chapters SET current = current + 1 WHERE id = ?').run(2);

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

/** Mirrors Android's native binding: `int` -> `char` narrowing keeps only the low byte. */
function toPrimaryErrcode(errcode) {
  return typeof errcode === 'number' ? errcode & 0xff : null;
}

export async function run() {
  const lab = createLabFile('h13');
  const evidence = [];
  try {
    const setup = openConn(lab.file);
    seed(setup);
    setup.close();

    const snapshotUpgrade = armSnapshotUpgrade(lab.file);
    const exhaustedTimeout = armExhaustedTimeout(lab.file);

    const snapshotErr = describeError(snapshotUpgrade.error);
    const timeoutErr = describeError(exhaustedTimeout.error);
    const snapshotPrimary = toPrimaryErrcode(snapshotErr?.errcode);
    const timeoutPrimary = toPrimaryErrcode(timeoutErr?.errcode);

    evidence.push(
      `arm A (snapshot upgrade): ok=${snapshotUpgrade.ok}, elapsed=${snapshotUpgrade.ms.toFixed(2)}ms, extended errcode=${snapshotErr?.errcode}, primary (Android-observable) errcode=${snapshotPrimary}`,
    );
    evidence.push(
      `arm B (exhausted busy_timeout): ok=${exhaustedTimeout.ok}, elapsed=${exhaustedTimeout.ms.toFixed(2)}ms, extended errcode=${timeoutErr?.errcode}, primary (Android-observable) errcode=${timeoutPrimary}`,
    );
    evidence.push(
      `once masked to the primary byte, both failures report errcode=${snapshotPrimary} -- indistinguishable by errcode alone; elapsedMs (${snapshotUpgrade.ms.toFixed(2)}ms vs ${exhaustedTimeout.ms.toFixed(2)}ms) is the discriminator that survives expo's control-byte format`,
    );

    const armAInstant = !snapshotUpgrade.ok && snapshotUpgrade.ms < 500;
    const armBExhausted = !exhaustedTimeout.ok && exhaustedTimeout.ms > 4000;
    const extendedCodesDiffer = snapshotErr?.errcode === 517 && timeoutErr?.errcode === 5;
    const primaryCodesCollide =
      snapshotPrimary !== null && snapshotPrimary === timeoutPrimary;

    return {
      ...meta,
      observed: `arm A failed after ${snapshotUpgrade.ms.toFixed(2)}ms (extended errcode ${snapshotErr?.errcode}); arm B failed after ${exhaustedTimeout.ms.toFixed(2)}ms (extended errcode ${timeoutErr?.errcode}); both mask to primary errcode ${snapshotPrimary}`,
      verdict:
        armAInstant && armBExhausted && extendedCodesDiffer && primaryCodesCollide
          ? VERDICT.CONFIRMED
          : VERDICT.FALSIFIED,
      evidence,
    };
  } finally {
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
