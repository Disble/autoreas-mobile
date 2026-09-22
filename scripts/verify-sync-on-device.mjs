// Device acceptance instrument for the native background sync work.
//
// Runs the twelve acceptance checks from the sync investigation against the tablet over adb
// and prints a verdict per check (PASS / FAIL / UNKNOWN) with the raw evidence it read.
// It is read-only on the device: dumpsys, logcat -d, am get-standby-bucket and file reads
// through `run-as cat`. Exits non-zero when any check fails; exits 2 (cleanly, no stack
// trace) when a device gate stops the run (no usable device, or a locked device).
//
// Usage: node scripts/verify-sync-on-device.mjs
//
// This file is the thin entry point only: the device gates (attachment, unlock), running the
// checks in order, printing the summary table, and computing the exit code. The adb-driven
// checks and all adb parsing live in scripts/lib/device-checks.mjs; the host-sqlite3 plumbing
// and the pure-DB checks (Attempt freshness, Cycle closure) live in
// scripts/lib/device-db-checks.mjs.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  checkBuildIdentity,
  checkDeviceUnlocked,
  checkEngineInvoked,
  checkExecutionGuardBurns,
  checkJournalWritten,
  checkLabReadableBuild,
  checkNativeSeamWarnings,
  checkServiceState,
  checkStandbyBucket,
  checkTickerAlive,
  parseAdbDeviceStates,
  runAdb,
} from './lib/device-checks.mjs';
import { checkAttemptFreshness, checkCycleClosure, resolveSqlite3 } from './lib/device-db-checks.mjs';

/** Verdicts collected in run order; printed per check and summarized at the end. */
const results = [];

/**
 * Records and immediately prints one check outcome with its evidence.
 *
 * @param {{name: string, verdict: 'PASS' | 'FAIL' | 'UNKNOWN', evidence: string}} outcome - outcome produced by a lib check.
 * @returns {void}
 */
function record(outcome) {
  results.push(outcome);
  console.log(`\n[${results.length}/12] ${outcome.name} ... ${outcome.verdict}`);
  for (const line of outcome.evidence.split('\n')) console.log(`       | ${line}`);
}

/**
 * Check 1: exactly one device attached in `device` state. Stops the run otherwise.
 *
 * @returns {boolean} whether the run may continue.
 */
function checkDeviceAttached() {
  if (!runAdb(['version']).ok) {
    console.error('verify-sync: adb not found or not usable on PATH.');
    console.error('verify-sync: install the Android platform-tools and re-run.');
    return false;
  }
  const res = runAdb(['devices']);
  const ready = parseAdbDeviceStates(res.out).filter((state) => state === 'device');
  if (ready.length === 1) {
    record({ name: 'Device attached', verdict: 'PASS', evidence: `exactly one device in 'device' state:\n${res.out.trim()}` });
    return true;
  }
  console.error(`verify-sync: expected exactly one device in 'device' state, found ${ready.length}.`);
  console.error(res.out.trim() || '(adb devices produced no output)');
  console.error('verify-sync: attach the tablet, authorize USB debugging, and re-run. Stopping.');
  return false;
}

/**
 * Device gate 2: the device must be unlocked before any acceptance check runs. The app cannot
 * complete its JS startup while the keyguard is up, so a locked device would waste the whole
 * window; like a missing device, this stops the run with exit code 2. The gate outcome is
 * printed for the operator but not recorded, so the numbered acceptance checks stay twelve.
 *
 * @returns {boolean} whether the run may continue.
 */
function requireDeviceUnlocked() {
  const gate = checkDeviceUnlocked();
  console.log(`\n[gate] ${gate.name} ... ${gate.verdict}`);
  for (const line of gate.evidence.split('\n')) console.log(`       | ${line}`);
  return gate.verdict === 'PASS';
}

/**
 * Prints the compact summary table and the final passed count.
 *
 * @returns {{failed: number, unknown: number}} tallies used for the exit code.
 */
function printSummary() {
  const width = Math.max(...results.map((r) => r.name.length));
  console.log('\nSummary');
  for (const r of results) {
    const first = r.evidence.split('\n')[0];
    console.log(`${r.name.padEnd(width)}  ${r.verdict.padEnd(7)}  ${first}`);
  }
  const passed = results.filter((r) => r.verdict === 'PASS').length;
  const failed = results.filter((r) => r.verdict === 'FAIL').length;
  const unknown = results.filter((r) => r.verdict === 'UNKNOWN').length;
  console.log(`\n${passed}/${results.length} checks passed, ${failed} failed, ${unknown} unknown.`);
  return { failed, unknown };
}

/**
 * Runs both device gates in order: exactly one usable device, then an unlocked screen. Each gate
 * prints its own reason when it stops the run.
 *
 * @returns {boolean} whether the run may continue to the acceptance checks.
 */
function deviceGatesPass() {
  return checkDeviceAttached() && requireDeviceUnlocked();
}

/**
 * Runs the twelve checks in order against the connected device.
 *
 * @param {string} workDir - host temp directory for pulled database files.
 * @returns {number} process exit code.
 */
function runChecks(workDir) {
  if (!deviceGatesPass()) return 2;
  const sqlite3 = resolveSqlite3();
  console.log(`\nhost sqlite3: ${sqlite3 ?? 'not found (DB-backed checks degrade)'}`);
  record(checkBuildIdentity());
  record(checkLabReadableBuild());
  record(checkServiceState());
  // The [nativeSeam] check comes FIRST among the log-derived checks on purpose: a seam-degradation
  // warning is the earliest and cheapest decisive signal this failure class exists — it explains
  // the wake-lock and engine absences that the later checks would otherwise report as symptoms.
  record(checkNativeSeamWarnings());
  record(checkTickerAlive());
  record(checkEngineInvoked(sqlite3, workDir));
  record(checkJournalWritten(sqlite3, workDir));
  record(checkAttemptFreshness(sqlite3, workDir));
  // The cycle-closure check sits right after Attempt freshness on purpose: it reads the same
  // pulled database and carries the primary acceptance metric of
  // docs/mobile-sync-architecture.md §9 — consecutive_unclosed_cycles = 0 — plus the journal
  // FSM's per-cycle newest transitions.
  record(checkCycleClosure(sqlite3, workDir));
  record(checkExecutionGuardBurns());
  record(checkStandbyBucket());
  const { failed } = printSummary();
  return failed > 0 ? 1 : 0;
}

/**
 * Entry point: prepares the temp workspace, runs the checks, cleans up, exits.
 *
 * @returns {void}
 */
function main() {
  let workDir;
  try {
    workDir = mkdtempSync(path.join(tmpdir(), 'verify-sync-'));
  } catch (error) {
    console.error(`verify-sync: cannot create a temp directory: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
  let code;
  try {
    code = runChecks(workDir);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  process.exit(code);
}

try {
  main();
} catch (error) {
  console.error(`verify-sync: unexpected failure: ${error instanceof Error ? error.stack ?? error.message : error}`);
  console.error('verify-sync: this is a bug in the instrument, not an acceptance verdict.');
  process.exit(2);
}
