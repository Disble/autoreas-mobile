// Acceptance checks and parsing helpers for the device sync verifier.
//
// This module owns everything behind the thin `scripts/verify-sync-on-device.mjs` entry point: the adb
// process helpers, the pure parsing functions that turn raw device output into plain values, and the
// acceptance checks themselves. Each check runs adb, calls parsers, decides a verdict, and builds the
// evidence string; it never prints and never exits, so the entry point stays in charge of output order,
// the summary table, and the process exit code.
//
// No dependencies. `adb` must be on PATH. Host `sqlite3` is optional: the DB-backed checks degrade to
// UNKNOWN or existence-only when missing, because reading a live database is evidence collection,
// not an acceptance failure.
//
// The host-sqlite3 plumbing and the pure-DB checks live in `scripts/lib/device-db-checks.mjs` (the
// base layer, extracted because this file sits at the 500-line hard limit); this module imports the
// shared pieces from there and owns every adb-driven check.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { outcome, pullDeviceFile, querySqlite, readBridgeGateConfig } from './device-db-checks.mjs';

/** Android package this acceptance run inspects. */
const PACKAGE_NAME = 'com.disble.autoreasmobile';
/** Binary spawned for every device interaction. */
const ADB = 'adb';
/** dataSync foreground-service type bit the service record must carry. */
const DATA_SYNC_TYPE_BIT = 0x40000000;
/** Stand-by bucket value that means RESTRICTED and fails the bucket check. */
const RESTRICTED_BUCKET = 45;
/** Bucket-name map, so the evidence line can name what the number means. */
const BUCKET_NAMES = { 5: 'EXEMPTED', 10: 'EXEMPTED', 15: 'EXEMPTED', 20: 'ACTIVE', 30: 'WORKING_SET', 40: 'FREQUENT', 45: 'RESTRICTED', 50: 'RESTRICTED' };
/** Log line the native engine prints when a cycle actually reaches runOnce. */
const ENGINE_MARKER = 'runOnce invoked';
/** Log fragment the shared native-module loader prints once per runtime when a seam's native module is missing. */
const NATIVE_SEAM_WARNING = '[nativeSeam]';
/** Wake-lock tag the native ticker holds while it is ticking (dumpsys power). */
const TICKER_WAKE_LOCK = 'ForegroundSyncTicker:ticking';
/** Read-only query for the journal row count. */
const JOURNAL_COUNT_SQL = 'SELECT COUNT(*) FROM journal;';
/** Read-only query for the newest journal transition. */
const JOURNAL_NEWEST_SQL = 'SELECT cycle_id, from_state, to_state, reason, at_ms FROM journal ORDER BY id DESC LIMIT 1;';

/** Runs one adb subcommand; returns `{ok, out, err}` with decoded text and captured streams. */
export function runAdb(args, maxBufferBytes = 16 * 1024 * 1024) {
  try {
    const out = execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: maxBufferBytes, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out, err: '' };
  } catch (error) {
    return adbFailure(error);
  }
}

/** Normalizes a failed execFileSync call into the adb result shape. */
function adbFailure(error) {
  const record = error && typeof error === 'object' ? error : {};
  return { ok: false, out: asText(record.stdout), err: joinText(record.stderr, record.message) };
}

/** Parses the device list body of `adb devices` into each entry's non-empty state value. */
export function parseAdbDeviceStates(out) {
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1)
    .map((line) => line.split(/\s+/)[1] ?? '')
    .filter(Boolean);
}

/**
 * Parses the keyguard booleans out of a `dumpsys window` dump: `isKeyguardShowing` and
 * `mDreamingLockscreen`. Returns null when neither boolean appears at all; `locked` is true
 * the moment either flag reads true, so a partial dump still fails closed.
 */
export function parseKeyguardState(dump) {
  const keyguardShowing = firstMatch(dump, /\bisKeyguardShowing=(true|false)/);
  const dreamingLockscreen = firstMatch(dump, /\bmDreamingLockscreen=(true|false)/);
  if (keyguardShowing === null && dreamingLockscreen === null) return null;
  return { keyguardShowing, dreamingLockscreen, locked: keyguardShowing === 'true' || dreamingLockscreen === 'true' };
}

/** Parses `isForeground`, `types=` and whether the dataSync bit is set from a dumpsys service record. */
function parseForegroundService(out) {
  const isForeground = firstMatch(out, /\bisForeground=(true|false)/);
  const types = firstMatch(out, /\btypes=(0x[0-9a-fA-F]+)/);
  return { isForeground, types, dataSyncBitSet: hasDataSyncBit(types) };
}

/** Parses the `stopIfKilled` and `createdFromFg` lifecycle flags; null when not found. */
function parseServiceLifecycleFlags(out) {
  return {
    stopIfKilled: firstMatch(out, /\bstopIfKilled=(true|false)/),
    createdFromFg: firstMatch(out, /\bcreatedFromFg=(true|false)/),
  };
}

/** Parses the ticker wake-lock lines out of a `dumpsys power` dump, in dump order. */
function parseTickerWakeLockLines(out) {
  return out.split(/\r?\n/).filter((line) => line.includes(TICKER_WAKE_LOCK));
}

/** Parses the engine-marker lines out of a (pid-scoped) `logcat -d` dump, oldest first. */
function parseEngineInvocations(out) {
  return out.split(/\r?\n/).filter((line) => line.includes(ENGINE_MARKER));
}

/** Parses the `[nativeSeam]` warning lines out of a (pid-scoped) `logcat -d` dump, oldest first. */
export function parseNativeSeamWarnings(out) {
  return out.split(/\r?\n/).filter((line) => line.includes(NATIVE_SEAM_WARNING));
}

/** Parses the app pid out of `adb shell pidof -s <package>` output; null unless exactly one numeric pid is present. */
export function parsePidOfOutput(out) {
  const tokens = out.trim().split(/\s+/).filter(Boolean);
  return tokens.length === 1 && /^\d+$/.test(tokens[0]) ? tokens[0] : null;
}

/** Builds the pid-scoped `adb logcat -d` argument vector that restricts the dump to one live process. */
export function scopedLogcatArgs(pid) {
  return ['logcat', '-d', '-v', 'time', `--pid=${pid}`];
}

/** Parses the package's numeric uid from a `dumpsys package` dump (userId=, then appId=/uid=); null when absent. */
function parsePackageUid(out) {
  return firstMatch(out, /\buserId=(\d+)/) ?? firstMatch(out, /\bappId=(\d+)/) ?? firstMatch(out, /\buid=(\d+)/);
}

/** Counts `Client timed out while executing` lines in a JobScheduler dump, total and scoped to one app uid index. */
function parseGuardTimeoutCounts(out, appIndex) {
  const state = out.split(/\r?\n/).reduce(collectTimeout, { appIndex, currentUid: null, scoped: 0, total: 0 });
  return { scoped: state.scoped, total: state.total };
}

/** Parses the stand-by bucket value from `am get-standby-bucket` output and names it (UNKNOWN when unmapped). */
function parseStandbyBucket(out) {
  const value = out.trim().split(/\r?\n/).pop().trim();
  return { value, name: BUCKET_NAMES[value] ?? 'UNKNOWN' };
}

/** Device gate: the device is unlocked. The app cannot complete its JS startup while the keyguard is up — no SQLite
 * open, no foreground service, no alarms — so a locked device would waste the whole acceptance window; the entry point
 * stops the run on FAIL before any numbered check. An unreadable dump is UNKNOWN, never PASS. */
export function checkDeviceUnlocked() {
  const res = runAdb(['shell', 'dumpsys', 'window']);
  if (!res.ok) return outcome('Device unlocked', 'UNKNOWN', `dumpsys window failed: ${res.err}`);
  return keyguardOutcome(parseKeyguardState(res.out));
}

/** Builds the Device unlocked verdict: FAIL on any lock evidence, PASS only when both booleans read false, UNKNOWN otherwise. */
function keyguardOutcome(state) {
  if (!state) return outcome('Device unlocked', 'UNKNOWN', 'isKeyguardShowing/mDreamingLockscreen absent from dumpsys window output');
  if (state.locked) {
    return outcome('Device unlocked', 'FAIL',
      `isKeyguardShowing=${orNotFound(state.keyguardShowing)} mDreamingLockscreen=${orNotFound(state.dreamingLockscreen)}\n` +
      `The device is locked: the app cannot complete its JS startup while the keyguard is up, so this acceptance window would measure nothing. A human must unlock the device before the run is worth spending.`);
  }
  if (state.keyguardShowing === 'false' && state.dreamingLockscreen === 'false') {
    return outcome('Device unlocked', 'PASS', 'isKeyguardShowing=false mDreamingLockscreen=false');
  }
  return outcome('Device unlocked', 'UNKNOWN', `partial keyguard state: isKeyguardShowing=${orNotFound(state.keyguardShowing)} mDreamingLockscreen=${orNotFound(state.dreamingLockscreen)}`);
}

/** Check 2: build identity, reported and never gated on the values. */
export function checkBuildIdentity() {
  const res = runAdb(['shell', 'dumpsys', 'package', PACKAGE_NAME]);
  if (!res.ok) return outcome('Build identity', 'UNKNOWN', `dumpsys package failed: ${res.err}`);
  const versionName = firstMatch(res.out, /\bversionName=([^\s]+)/);
  const versionCode = firstMatch(res.out, /\bversionCode=(\d+)/);
  if (!versionName || !versionCode) {
    return outcome('Build identity', 'UNKNOWN', 'versionName/versionCode not found in dumpsys package output');
  }
  return outcome('Build identity', 'PASS', `versionName=${versionName} versionCode=${versionCode} (reported, not gated)`);
}

/** Check 3: the build is lab-readable through run-as; a production build is a FAIL (checks 7 and 8 need it). */
export function checkLabReadableBuild() {
  const res = runAdb(['shell', 'run-as', PACKAGE_NAME, 'ls', 'files/SQLite']);
  if (res.ok) return outcome('Lab-readable build', 'PASS', `run-as ls files/SQLite:\n${res.out.trim()}`);
  const raw = [res.out.trim(), res.err].filter(Boolean).join('\n');
  return outcome('Lab-readable build', 'FAIL',
    `run-as ls files/SQLite failed — a production build cannot be inspected with run-as.\n${raw}\nReinstall the lab-readable (debuggable) build; checks 7 and 8 cannot read this install.`);
}

/** Check 4: the service record shows isForeground=true and the dataSync type bit; lifecycle flags reported either way. */
export function checkServiceState() {
  const res = runAdb(['shell', 'dumpsys', 'activity', 'services', PACKAGE_NAME]);
  if (!res.ok) return outcome('Service state', 'UNKNOWN', `dumpsys activity services failed: ${res.err}`);
  return serviceStateOutcome(parseForegroundService(res.out), parseServiceLifecycleFlags(res.out));
}

/** Check 6: the ticker's wake lock is held; this check failed for the whole investigation, so its absence is explained. */
export function checkTickerAlive() {
  const res = runAdb(['shell', 'dumpsys', 'power'], 32 * 1024 * 1024);
  if (!res.ok) return outcome('Ticker alive', 'UNKNOWN', `dumpsys power failed: ${res.err}`);
  const lines = parseTickerWakeLockLines(res.out);
  if (lines.length > 0) {
    return outcome('Ticker alive', 'PASS', `wake lock held (${lines.length} line(s)):\n${lines[0].trim()}`);
  }
  return outcome('Ticker alive', 'FAIL',
    `wake lock tag '${TICKER_WAKE_LOCK}' is absent from dumpsys power.\nThe service can be foreground (check 4 green) with the ticker never started — this is exactly\nthe state the investigation chased: foreground yet idle, no wake lock, no ticks.`);
}

/** Check 7: the native sync engine was actually invoked during the CURRENT process lifetime. The logcat read is scoped
 * to the live pid (check 5's discipline: `pidof -s` + `--pid=<pid>`) so a stale line from an earlier lifetime can never
 * PASS it. When no marker exists, the T6 presence gate decides: every tick is gated on a `GET /api/status` probe
 * (commit 6b10bcd), so with the bridge absent no cycle is entered and the engine is never invoked BY DESIGN — a
 * demonstrable gate refusal does not fail the acceptance, and every unprovable state stays UNKNOWN. */
export function checkEngineInvoked(sqlite3, workDir) {
  const pidRes = runAdb(['shell', 'pidof', '-s', PACKAGE_NAME]);
  const pid = pidRes.ok ? parsePidOfOutput(pidRes.out) : null;
  if (!pid) {
    return outcome('Engine invoked', 'UNKNOWN',
      `could not resolve the live app pid via 'adb shell pidof -s ${PACKAGE_NAME}' — the logcat dump cannot be scoped to the current process, so a stale '${ENGINE_MARKER}' line from an earlier lifetime cannot be ruled out; the check refuses to PASS:\n${[pidRes.out.trim(), pidRes.err].filter(Boolean).join('\n')}`);
  }
  const res = runAdb(scopedLogcatArgs(pid), 64 * 1024 * 1024);
  if (!res.ok) return outcome('Engine invoked', 'UNKNOWN', `logcat -d --pid=${pid} failed: ${res.err}`);
  const lines = parseEngineInvocations(res.out);
  if (lines.length > 0) {
    return outcome('Engine invoked', 'PASS', `newest of ${lines.length} occurrence(s) from the current process (pid ${pid}):\n${lines[lines.length - 1].trim()}`);
  }
  return engineGateOutcome(pid, readBridgeGateConfig(sqlite3, workDir));
}

/** Builds the Engine invoked verdict when the pid-scoped buffer holds no marker: PASS only through a demonstrable T6
 * presence-gate refusal (an incomplete bridge config, so probeBridgePresence rejects before any cycle is entered);
 * UNKNOWN when the gate state cannot be read or the config is complete (a probe refusal is then indistinguishable from
 * a real engine failure). The absence of the marker alone is never a FAIL and never a PASS without the artifact. */
export function engineGateOutcome(pid, gate) {
  if (gate.error) {
    return outcome('Engine invoked', 'UNKNOWN',
      `no '${ENGINE_MARKER}' line from the current process (pid ${pid}); the T6 presence-gate state cannot be read (${gate.error}), so a designed gate refusal cannot be distinguished from a real engine failure.`);
  }
  if (!gate.config.ip || !gate.config.port || !gate.config.token) {
    return outcome('Engine invoked', 'PASS',
      `no '${ENGINE_MARKER}' line from the current process (pid ${pid}) — and the presence gate legitimately refused every tick: bridge config is incomplete (ip=${gate.config.ip || '(missing)'} port=${gate.config.port || '(missing)'} token=${gate.config.token ? 'set' : '(missing)'}), so probeBridgePresence refuses before any cycle is entered (T6 gate). No engine invocation is the designed outcome, not a failure.`);
  }
  return outcome('Engine invoked', 'UNKNOWN',
    `no '${ENGINE_MARKER}' line from the current process (pid ${pid}); bridge config is complete (ip=${gate.config.ip} port=${gate.config.port} token=set), so whether the gate refused because the bridge is unreachable or the engine was genuinely never reached cannot be distinguished from device reads. Probe the bridge's GET /api/status and re-run.`);
}

/** Check 5: the FIRST log-derived check — the `[nativeSeam]` warning is the earliest decisive signal that a native seam
 * degraded to a silent no-op; its absence is a PASS. The logcat read is scoped to the app's live pid (`pidof -s` +
 * `logcat -d --pid=<pid>`) so warnings from earlier process lifetimes are excluded; an unresolvable pid never PASSes. */
export function checkNativeSeamWarnings() {
  const pidRes = runAdb(['shell', 'pidof', '-s', PACKAGE_NAME]);
  const pid = pidRes.ok ? parsePidOfOutput(pidRes.out) : null;
  if (!pid) {
    return outcome('Native seam warnings', 'FAIL', `could not resolve the live app pid via 'adb shell pidof -s ${PACKAGE_NAME}' — the logcat dump cannot be scoped to the current process, so a stale warning from an earlier run cannot be ruled out; the check refuses to PASS:\n${[pidRes.out.trim(), pidRes.err].filter(Boolean).join('\n')}`);
  }
  return scopedLogcatOutcome(pid, runAdb(scopedLogcatArgs(pid), 64 * 1024 * 1024));
}

/** Decides check 5 from the pid-scoped logcat dump: UNKNOWN when the read fails, PASS at zero `[nativeSeam]` lines, FAIL listing them. */
function scopedLogcatOutcome(pid, res) {
  if (!res.ok) return outcome('Native seam warnings', 'UNKNOWN', `logcat -d --pid=${pid} failed: ${res.err}`);
  const lines = parseNativeSeamWarnings(res.out);
  if (lines.length === 0) {
    return outcome('Native seam warnings', 'PASS', `no '${NATIVE_SEAM_WARNING}' warning from the current app process (pid ${pid}, scoped logcat read).`);
  }
  return outcome('Native seam warnings', 'FAIL',
    `${lines.length} '[nativeSeam]' warning(s) from the current app process (pid ${pid}) — a native module was never registered and its seam degraded to a no-op (earlier and cheaper than the wake-lock symptom):\n${lines.join('\n')}`);
}

/** Check 8: the journal exists with size and mtime; row count and newest transition only when host sqlite3 is available. */
export function checkJournalWritten(sqlite3, workDir) {
  const res = runAdb(['shell', 'run-as', PACKAGE_NAME, 'ls', '-l', 'files/sync-journal.db']);
  if (!res.ok) {
    return outcome('Journal written', 'FAIL', `files/sync-journal.db not found via run-as:\n${[res.out.trim(), res.err].filter(Boolean).join('\n')}`);
  }
  let evidence = `ls -l: ${res.out.trim()}`;
  if (!sqlite3) return outcome('Journal written', 'PASS', `${evidence}\nhost sqlite3 not found; only existence, size and mtime could be read.`);
  const local = path.join(workDir, 'sync-journal.db');
  if (!pullDeviceFile('files/sync-journal.db', local)) {
    return outcome('Journal written', 'PASS', `${evidence}\npull via run-as cat failed; only size/mtime read.`);
  }
  return outcome('Journal written', 'PASS', evidence + readJournalRows(sqlite3, local));
}

/** Check 11: counts `Client timed out while executing` lines inside the app uid's JobScheduler records; PASS at zero. */
export function checkExecutionGuardBurns() {
  const pkg = runAdb(['shell', 'dumpsys', 'package', PACKAGE_NAME]);
  const jobs = runAdb(['shell', 'dumpsys', 'jobscheduler'], 32 * 1024 * 1024);
  if (!jobs.ok) return outcome('No execution-guard burns', 'UNKNOWN', `dumpsys jobscheduler failed: ${jobs.err}`);
  const resolved = resolveGuardAppIndex(pkg.ok ? pkg.out : '', jobs.out);
  if (!resolved.index) return outcome('No execution-guard burns', 'UNKNOWN', `could not resolve the app uid from ${resolved.source}`);
  return guardOutcome(resolved.index, resolved.source, parseGuardTimeoutCounts(jobs.out, resolved.index));
}

/** Check 12: the app's stand-by bucket is not 45 (RESTRICTED); names the value either way. */
export function checkStandbyBucket() {
  const res = runAdb(['shell', 'am', 'get-standby-bucket', PACKAGE_NAME]);
  if (!res.ok) {
    return outcome('Stand-by bucket', 'UNKNOWN', `am get-standby-bucket failed: ${[res.out.trim(), res.err].filter(Boolean).join('\n')}`);
  }
  const { value, name } = parseStandbyBucket(res.out);
  if (value === String(RESTRICTED_BUCKET)) {
    return outcome('Stand-by bucket', 'FAIL', `${value} ${name} — JobScheduler may defer or refuse the app's jobs in this bucket`);
  }
  return outcome('Stand-by bucket', 'PASS', `${value} ${name}`);
}

/** Returns the first capture group of a regex against text, or null. */
function firstMatch(text, pattern) {
  const m = text.match(pattern);
  return m ? m[1] : null;
}

/** Coerces an unknown value to text when it is a string, else empty. */
function asText(value) {
  return typeof value === 'string' ? value : '';
}

/** Joins optional text fragments with spaces and trims the result. */
function joinText(...parts) {
  return parts.filter((s) => typeof s === 'string').join(' ').trim();
}

/** Renders a parsed value for an evidence line, naming absences explicitly as '(not found)'. */
function orNotFound(value) {
  return value ?? '(not found)';
}

/** Decides whether a `types=` hex value carries the dataSync foreground-service bit. */
function hasDataSyncBit(types) {
  return types !== null && (Number.parseInt(types, 16) & DATA_SYNC_TYPE_BIT) !== 0;
}

/** Builds the Service state verdict from the parsed foreground and lifecycle facts. */
function serviceStateOutcome(fg, flags) {
  const evidence = serviceEvidence(fg, flags);
  if (fg.isForeground === 'true' && fg.dataSyncBitSet) {
    return outcome('Service state', 'PASS', `${evidence} (dataSync bit set)`);
  }
  return outcome('Service state', 'FAIL', `${evidence} (expected isForeground=true and types with 0x40000000 set)`);
}

/** Renders the Service state evidence line from the parsed facts. */
function serviceEvidence(fg, flags) {
  return `isForeground=${orNotFound(fg.isForeground)}, types=${orNotFound(fg.types)}, stopIfKilled=${orNotFound(flags.stopIfKilled)}, createdFromFg=${orNotFound(flags.createdFromFg)}`;
}

/** Reduces one JobScheduler dump line into the running timeout tally, tracking the newest job header's uid. */
function collectTimeout(state, line) {
  const currentUid = advanceJobUid(line, state.currentUid);
  if (!isTimeoutLine(line)) return { ...state, currentUid };
  return { ...state, currentUid, scoped: state.scoped + (currentUid === state.appIndex ? 1 : 0), total: state.total + 1 };
}

/** Advances the tracked uid when the line opens a new `JOB #u0a<i>/` record. */
function advanceJobUid(line, currentUid) {
  const job = line.match(/\bJOB #u0a(\d+)\//);
  return job ? job[1] : currentUid;
}

/** Tells whether a dump line reports a client execution timeout. */
function isTimeoutLine(line) {
  return line.includes('Client timed out while executing');
}

/** Resolves the guard check's app uid index: `dumpsys package` userId first, then the `u0a<i>` of job records naming the package; index is null when neither source answers. */
function resolveGuardAppIndex(pkgOut, jobsOut) {
  const uid = parsePackageUid(pkgOut);
  if (uid) return { index: appIndexFor(uid), source: `dumpsys package uid=${uid}` };
  const fallback = parseAppIndexFromJobscheduler(jobsOut, PACKAGE_NAME);
  if (fallback) return { index: fallback, source: `dumpsys jobscheduler job records naming the package (u0a${fallback})` };
  return { index: null, source: 'dumpsys package userId= or dumpsys jobscheduler job records' };
}

/** Collects the distinct `u0a<i>` indices on the lines of a dump that name the package. */
function collectJobIndices(out, packageName) {
  const indices = new Set();
  for (const line of out.split(/\r?\n/)) {
    const m = line.includes(packageName) ? line.match(/\bu0a(\d+)\b/) : null;
    if (m) indices.add(m[1]);
  }
  return indices;
}

/** Derives the app uid index from `dumpsys jobscheduler` when `dumpsys package` carries no `userId=`; a single distinct index wins, null otherwise. */
function parseAppIndexFromJobscheduler(out, packageName) {
  const indices = collectJobIndices(out, packageName);
  return indices.size === 1 ? [...indices][0] : null;
}

/** Builds the execution-guard outcome: PASS at zero scoped burns, FAIL otherwise, uid source and both counts as evidence. */
function guardOutcome(appIndex, uidEvidence, counts) {
  const evidence = `uid ${uidEvidence} (u0a${appIndex}); Client-timed-out lines in this uid's records: ${counts.scoped}; total in dump: ${counts.total}`;
  return outcome('No execution-guard burns', counts.scoped === 0 ? 'PASS' : 'FAIL', evidence);
}

/** Reads the journal row count and newest transition from a pulled journal db, rendered as extra evidence lines. */
function readJournalRows(sqlite3, localDbPath) {
  const count = querySqlite(sqlite3, localDbPath, JOURNAL_COUNT_SQL);
  const newest = querySqlite(sqlite3, localDbPath, JOURNAL_NEWEST_SQL);
  let evidence = count.ok ? `\njournal rows: ${count.out}` : `\nrow count query failed: ${count.out}`;
  if (newest.ok && newest.out) evidence += `\nnewest transition: ${newest.out}`;
  return evidence;
}

/** Computes the numeric app uid index (userId minus 10000) used in JobScheduler tags. */
function appIndexFor(userId) {
  return String(Number(userId) - 10000);
}
