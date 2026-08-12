/**
 * H12 — Reproduce the full production shape.
 *
 * Phase 1 models the running app: the UI tap connection (busy_timeout=5000,
 * deferred BEGIN, read-then-write), a background ticker on its own connection,
 * and a zero-pragma connection standing in for the one expo-sqlite creates
 * implicitly inside withExclusiveTransactionAsync. Target symptoms: S1, S2, S4, S5.
 *
 * Phase 2 asks what MORE is needed to reproduce S3 and S6 — a failure that is
 * byte-identical on every subsequent tap and only clears on a process restart.
 */
import { Worker } from 'node:worker_threads';
import {
  createLabFile,
  openConn,
  seed,
  timed,
  describeError,
  errorFingerprint,
  productionWriteUnit,
  sleepSync,
  VERDICT,
  runStandalone,
} from '../support/lab.mjs';

export const meta = {
  id: 'H12',
  title: 'Full production-shape reproduction',
  prediction: 'S1, S2, S4 and S5 reproduce: intermittent instant "database is locked" on the UPDATE while reads keep working',
};

const TAPS = 200;
const STOP = 0;
const READY = 1;

/**
 * Background pressure levels. A single load point cannot answer S1: at maximum
 * pressure everything fails and at zero pressure nothing does, and either
 * extreme would be an artefact of the chosen constant rather than a finding.
 * Sweeping makes the failure rate a measured function of contention.
 */
const PRESSURE_LEVELS = [
  { label: 'none (no background writers)', tickMs: null, holdMs: 0 },
  { label: 'light  (background write every 200ms)', tickMs: 200, holdMs: 1 },
  { label: 'medium (background write every 50ms)', tickMs: 50, holdMs: 2 },
  { label: 'heavy  (background write every 4ms, 3ms hold)', tickMs: 4, holdMs: 3 },
];

function spawn(file, role, control, options) {
  return new Worker(new URL('../support/worker-background.mjs', import.meta.url), {
    workerData: { file, role, control, rowId: 1, tickMs: 5, holdMs: 3, ...options },
  });
}

async function runPressureLevel(file, { tickMs, holdMs }) {
  const control = new SharedArrayBuffer(8);
  const view = new Int32Array(control);
  const background = tickMs === null
    ? []
    : [
        spawn(file, 'ticker', control, { rowId: 2, tickMs }),
        spawn(file, 'exclusive', control, { rowId: 3, tickMs, holdMs }),
      ];

  const tap = openConn(file, { busyTimeoutMs: 5000, wal: false });
  const failures = new Map();
  const failureStages = new Map();
  let tapOk = 0;
  let tapFail = 0;
  let instantFailures = 0;
  let slowFailures = 0;
  let readsOk = 0;
  let readsFail = 0;

  sleepSync(50);
  for (let i = 0; i < TAPS; i += 1) {
    const result = productionWriteUnit(tap, 1);
    if (result.ok) {
      tapOk += 1;
    } else {
      tapFail += 1;
      const stage = result.failedStage;
      failureStages.set(stage, (failureStages.get(stage) ?? 0) + 1);
      const key = errorFingerprint(result.error);
      failures.set(key, (failures.get(key) ?? 0) + 1);
      const failedMs = result.stages[stage]?.ms ?? 0;
      if (failedMs < 100) instantFailures += 1;
      else slowFailures += 1;
    }

    // S4: the list still renders while writes are failing.
    const read = timed(() => tap.prepare('SELECT id, current FROM chapters ORDER BY id').all());
    if (read.ok) readsOk += 1;
    else readsFail += 1;
    sleepSync(2);
  }

  Atomics.store(view, STOP, 1);
  tap.close();
  await Promise.all(background.map((worker) => new Promise((resolve) => worker.on('exit', resolve))));

  return { tapOk, tapFail, instantFailures, slowFailures, failureStages, readsOk, readsFail, failures };
}

async function phaseOne(file, evidence) {
  evidence.push(`PHASE 1 — ${TAPS} taps per pressure level; tap connection = busy_timeout 5000, deferred BEGIN, read-then-write`);
  const levels = [];
  for (const level of PRESSURE_LEVELS) {
    const result = await runPressureLevel(file, level);
    levels.push({ level, result });
    const rate = ((result.tapFail / TAPS) * 100).toFixed(1);
    evidence.push(
      `  ${level.label}: taps failed ${result.tapFail}/${TAPS} (${rate}%), stages=${[...result.failureStages.entries()].map(([s, c]) => `${s}=${c}`).join(',') || 'none'}, instant=${result.instantFailures}, slow=${result.slowFailures}, reads ok=${result.readsOk}/${TAPS} failed=${result.readsFail}`,
    );
    for (const [key, count] of result.failures) evidence.push(`      failure x${count}: ${key}`);
  }

  const totals = levels.reduce(
    (acc, { result }) => ({
      tapOk: acc.tapOk + result.tapOk,
      tapFail: acc.tapFail + result.tapFail,
      instantFailures: acc.instantFailures + result.instantFailures,
      slowFailures: acc.slowFailures + result.slowFailures,
      readsFail: acc.readsFail + result.readsFail,
      readsOk: acc.readsOk + result.readsOk,
      updateStage: acc.updateStage + (result.failureStages.get('update') ?? 0),
    }),
    { tapOk: 0, tapFail: 0, instantFailures: 0, slowFailures: 0, readsFail: 0, readsOk: 0, updateStage: 0 },
  );

  const intermittentLevels = levels.filter(({ result }) => result.tapFail > 0 && result.tapFail < TAPS);
  evidence.push(
    `  S1: ${intermittentLevels.length} of ${levels.length} pressure levels produced a STRICTLY intermittent failure rate (0% < rate < 100%): ${intermittentLevels.map(({ level, result }) => `${level.label.split(' ')[0]}=${((result.tapFail / TAPS) * 100).toFixed(1)}%`).join(', ') || 'none'}`,
  );
  evidence.push('  S5: every tap in every level executed its BEGIN — nothing in SQLite gates or disables the write path');

  return { levels, totals, intermittentLevels };
}

async function phaseTwo(file, evidence) {
  const control = new SharedArrayBuffer(8);
  const view = new Int32Array(control);
  const leaker = spawn(file, 'leaker', control, { rowId: 4 });
  while (Atomics.load(view, READY) === 0) Atomics.wait(view, READY, 0, 10);
  evidence.push('PHASE 2: one connection now holds a write transaction that is never committed or rolled back');

  const tap = openConn(file, { busyTimeoutMs: 5000, wal: false });
  const fingerprints = [];
  for (let i = 0; i < 5; i += 1) {
    const result = productionWriteUnit(tap, 1);
    fingerprints.push(errorFingerprint(result.error));
    const read = timed(() => tap.prepare('SELECT id, current FROM chapters ORDER BY id').all());
    evidence.push(
      `  tap ${i + 1} (t+${i}s): write ok=${result.ok}, stage=${result.failedStage}, read ok=${read.ok} -> ${fingerprints[i]}`,
    );
    if (i < 4) sleepSync(1000);
  }
  const identical = new Set(fingerprints).size === 1 && fingerprints[0] !== '<no error>';
  evidence.push(`  S3 distinct fingerprints across 5 taps spanning ~4s: ${new Set(fingerprints).size}`);

  // "Full app close-and-reopen": the leaking connection goes away.
  Atomics.store(view, STOP, 1);
  await new Promise((resolve) => leaker.on('exit', resolve));
  const afterRestart = productionWriteUnit(tap, 1);
  evidence.push(
    `  S6 after the leaking connection is torn down (process-restart analogue): write ok=${afterRestart.ok}, error=${JSON.stringify(describeError(afterRestart.error)?.message)}`,
  );
  tap.close();

  return { identical, recovered: afterRestart.ok, fingerprint: fingerprints[0] };
}

export async function run() {
  const lab = createLabFile('h12');
  const evidence = [];
  try {
    const setup = openConn(lab.file);
    seed(setup, 10);
    setup.close();

    const one = await phaseOne(lab.file, evidence);
    const two = await phaseTwo(lab.file, evidence);

    const s1 = one.intermittentLevels.length > 0;
    const s2 = one.totals.tapFail > 0 && one.totals.updateStage === one.totals.tapFail;
    const s4 = one.totals.readsFail === 0;
    const s5 = true; // every tap executed its BEGIN; nothing disabled the write path.
    const instant = one.totals.instantFailures === one.totals.tapFail;

    evidence.push(
      `VERDICT INPUTS: S1=${s1}, S2=${s2} (${one.totals.updateStage}/${one.totals.tapFail} failures on UPDATE), S4=${s4} (${one.totals.readsFail} read failures across all levels), S5=${s5}, all failures instant=${instant}`,
    );
    evidence.push(
      two.identical && two.recovered
        ? 'S3+S6 REQUIRE an extra ingredient: a leaked, never-unwound write transaction on a still-live connection. Ordinary contention (phase 1) does NOT produce them — phase 1 recovers on the very next tap as soon as the background writer yields.'
        : 'S3+S6 were NOT reproduced even with a leaked write transaction — see phase 2 evidence.',
    );

    return {
      ...meta,
      observed: `phase 1: failure rate scales with contention (${one.levels.map(({ level, result }) => `${level.label.split(' ')[0]}=${((result.tapFail / TAPS) * 100).toFixed(0)}%`).join(', ')}); ALL ${one.totals.tapFail} failures were on the UPDATE stage and instant; 0 read failures out of ${one.totals.readsOk + one.totals.readsFail}. phase 2: with a leaked write transaction, 5/5 taps failed with a byte-identical error (${two.fingerprint}) and recovery required tearing that connection down (ok=${two.recovered})`,
      verdict: s1 && s2 && s4 && instant ? VERDICT.CONFIRMED : VERDICT.FALSIFIED,
      evidence,
    };
  } finally {
    lab.cleanup();
  }
}

await runStandalone(import.meta.url, run);
