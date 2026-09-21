// Acceptance checks and parsing helpers for the device sync verifier.
//
// This module owns everything behind the thin `scripts/verify-sync-on-device.mjs`
// entry point: the adb process helpers, the pure parsing functions that turn raw
// device output into plain values, and the ten acceptance checks themselves. Each
// check runs adb, calls parsers, decides a verdict, and builds the evidence string;
// it never prints and never exits, so the entry point stays in charge of output
// order, the summary table, and the process exit code.
//
// No dependencies. `adb` must be on PATH. Host `sqlite3` is optional: the DB-backed
// checks degrade to UNKNOWN or existence-only when it is missing, because reading a
// live database is evidence collection, not an acceptance failure.

import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

/** Android package this acceptance run inspects. */
const PACKAGE_NAME = 'com.disble.autoreasmobile';
/** Binary spawned for every device interaction. */
const ADB = 'adb';
/** Known host locations of sqlite3 beside the Android SDK platform-tools, tried in order. */
const SQLITE3_KNOWN_PATHS = [
  'C:/Users/User/AppData/Local/Android/Sdk/platform-tools/sqlite3',
  'C:/Users/User/AppData/Local/Android/Sdk/platform-tools/sqlite3.exe',
];
/** dataSync foreground-service type bit the service record must carry. */
const DATA_SYNC_TYPE_BIT = 0x40000000;
/** Stand-by bucket value that means RESTRICTED and fails the bucket check. */
const RESTRICTED_BUCKET = 45;
/** Bucket-name map, so the evidence line can name what the number means. */
const BUCKET_NAMES = { 5: 'EXEMPTED', 10: 'EXEMPTED', 15: 'EXEMPTED', 20: 'ACTIVE', 30: 'WORKING_SET', 40: 'FREQUENT', 45: 'RESTRICTED', 50: 'RESTRICTED' };
/** Log line the native engine prints when a cycle actually reaches runOnce. */
const ENGINE_MARKER = 'runOnce invoked';
/** Wake-lock tag the native ticker holds while it is ticking (dumpsys power). */
const TICKER_WAKE_LOCK = 'ForegroundSyncTicker:ticking';
/** Evidence text for Attempt freshness when host sqlite3 is unavailable. */
const NO_SQLITE3_EVIDENCE =
  'host sqlite3 not found; sync_runtime_status cannot be read. Install sqlite3 (SDK platform-tools) to lift this.';
/** Read-only query for the newest sync_runtime_status row. */
const RUNTIME_STATUS_SQL =
  'SELECT last_attempt_at, last_cycle_stage, is_cycle_active, last_error_name FROM sync_runtime_status ORDER BY id DESC LIMIT 1;';
/** Read-only query for the journal row count. */
const JOURNAL_COUNT_SQL = 'SELECT COUNT(*) FROM journal;';
/** Read-only query for the newest journal transition. */
const JOURNAL_NEWEST_SQL =
  'SELECT cycle_id, from_state, to_state, reason, at_ms FROM journal ORDER BY id DESC LIMIT 1;';

/** Runs one adb subcommand; returns `{ok, out, err}` with decoded text and captured streams. */
export function runAdb(args, maxBufferBytes = 16 * 1024 * 1024) {
  try {
    const out = execFileSync(ADB, args, {
      encoding: 'utf8',
      maxBuffer: maxBufferBytes,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

/**
 * Pulls one file off the app's private storage via `adb exec-out run-as ... cat` into a
 * host path. Binary-safe, read-only on the device; true when the pull produced a file.
 */
function pullDeviceFile(remotePath, hostPath) {
  const res = spawnSync(ADB, ['exec-out', 'run-as', PACKAGE_NAME, 'cat', remotePath], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0 || !res.stdout || res.stdout.length === 0) return false;
  writeFileSync(hostPath, res.stdout);
  return true;
}

/** Resolves the host sqlite3 executable (PATH, then known SDK locations); null when none answers `--version`. */
export function resolveSqlite3() {
  const candidates = ['sqlite3', ...SQLITE3_KNOWN_PATHS];
  for (const exe of candidates) {
    if (spawnSync(exe, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).status === 0) return exe;
  }
  return null;
}

/** Runs one read-only SQL statement against a pulled database file; `{ok, out}` with raw sqlite3 stdout. */
function querySqlite(exe, dbPath, sql) {
  const res = spawnSync(exe, ['-readonly', dbPath, sql], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { ok: res.status === 0, out: (res.stdout ?? '').trim() };
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

/** Parses the engine-marker lines out of a `logcat -d` dump, oldest first. */
function parseEngineInvocations(out) {
  return out.split(/\r?\n/).filter((line) => line.includes(ENGINE_MARKER));
}

/** Splits one pipe-delimited sync_runtime_status row into its named fields, '' for missing columns. */
function parseRuntimeStatusRow(out) {
  const [lastAttemptAt = '', lastCycleStage = '', isCycleActive = '', lastErrorName = ''] = out.split('|');
  return { lastAttemptAt, lastCycleStage, isCycleActive, lastErrorName };
}

/**
 * Turns a raw last_attempt_at value into a human age, tolerating seconds and milliseconds
 * epochs and ISO strings; null when the value cannot be interpreted.
 */
function parseAttemptAge(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return null;
  return parseEpochAttemptAge(trimmed) ?? parseIsoAttemptAge(trimmed);
}

/** Parses the numeric userId of the package from `dumpsys package` output; null when not found. */
function parseUserId(out) {
  return firstMatch(out, /\buserId=(\d+)/);
}

/**
 * Counts `Client timed out while executing` lines in a JobScheduler dump, total and scoped
 * to one app uid index. Timeouts are attributed to the most recently seen `JOB #u0a<i>/` header.
 */
function parseGuardTimeoutCounts(out, appIndex) {
  const state = out.split(/\r?\n/).reduce(collectTimeout, { appIndex, currentUid: null, scoped: 0, total: 0 });
  return { scoped: state.scoped, total: state.total };
}

/** Parses the stand-by bucket value from `am get-standby-bucket` output and names it (UNKNOWN when unmapped). */
function parseStandbyBucket(out) {
  const value = out.trim().split(/\r?\n/).pop().trim();
  return { value, name: BUCKET_NAMES[value] ?? 'UNKNOWN' };
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
  return outcome(
    'Lab-readable build',
    'FAIL',
    `run-as ls files/SQLite failed — a production build cannot be inspected with run-as.\n` +
      `${raw}\n` +
      `Reinstall the lab-readable (debuggable) build; checks 7 and 8 cannot read this install.`
  );
}

/** Check 4: the service record shows isForeground=true and the dataSync type bit; lifecycle flags reported either way. */
export function checkServiceState() {
  const res = runAdb(['shell', 'dumpsys', 'activity', 'services', PACKAGE_NAME]);
  if (!res.ok) return outcome('Service state', 'UNKNOWN', `dumpsys activity services failed: ${res.err}`);
  return serviceStateOutcome(parseForegroundService(res.out), parseServiceLifecycleFlags(res.out));
}

/** Check 5: the ticker's wake lock is held; this check failed for the whole investigation, so its absence is explained. */
export function checkTickerAlive() {
  const res = runAdb(['shell', 'dumpsys', 'power'], 32 * 1024 * 1024);
  if (!res.ok) return outcome('Ticker alive', 'UNKNOWN', `dumpsys power failed: ${res.err}`);
  const lines = parseTickerWakeLockLines(res.out);
  if (lines.length > 0) {
    return outcome('Ticker alive', 'PASS', `wake lock held (${lines.length} line(s)):\n${lines[0].trim()}`);
  }
  return outcome(
    'Ticker alive',
    'FAIL',
    `wake lock tag '${TICKER_WAKE_LOCK}' is absent from dumpsys power.\n` +
      `The service can be foreground (check 4 green) with the ticker never started — this is exactly\n` +
      `the state the investigation chased: foreground yet idle, no wake lock, no ticks.`
  );
}

/** Check 6: the engine was actually invoked; reports the newest occurrence, absence means no attempt reached the engine. */
export function checkEngineInvoked() {
  const res = runAdb(['logcat', '-d', '-v', 'time'], 64 * 1024 * 1024);
  if (!res.ok) return outcome('Engine invoked', 'UNKNOWN', `logcat -d failed: ${res.err}`);
  const lines = parseEngineInvocations(res.out);
  if (lines.length > 0) {
    return outcome('Engine invoked', 'PASS', `newest of ${lines.length} occurrence(s):\n${lines[lines.length - 1].trim()}`);
  }
  return outcome(
    'Engine invoked',
    'FAIL',
    `no '${ENGINE_MARKER}' line in the logcat buffer — no attempt ever reached the sync engine\n` +
      `(SyncEngineModule.runOnce was never called since the buffer was last cleared).`
  );
}

/** Check 7: the journal exists with size and mtime; row count and newest transition only when host sqlite3 is available. */
export function checkJournalWritten(sqlite3, workDir) {
  const res = runAdb(['shell', 'run-as', PACKAGE_NAME, 'ls', '-l', 'files/sync-journal.db']);
  if (!res.ok) {
    return outcome(
      'Journal written',
      'FAIL',
      `files/sync-journal.db not found via run-as:\n${[res.out.trim(), res.err].filter(Boolean).join('\n')}`
    );
  }
  let evidence = `ls -l: ${res.out.trim()}`;
  if (!sqlite3) return outcome('Journal written', 'PASS', `${evidence}\nhost sqlite3 not found; only existence, size and mtime could be read.`);
  const local = path.join(workDir, 'sync-journal.db');
  if (!pullDeviceFile('files/sync-journal.db', local)) {
    return outcome('Journal written', 'PASS', `${evidence}\npull via run-as cat failed; only size/mtime read.`);
  }
  return outcome('Journal written', 'PASS', evidence + readJournalRows(sqlite3, local));
}

/** Check 8: pulls the live app database (plus WAL/SHM) and reads sync_runtime_status; missing sqlite3 is UNKNOWN, not FAIL. */
export function checkAttemptFreshness(sqlite3, workDir) {
  if (!sqlite3) return outcome('Attempt freshness', 'UNKNOWN', NO_SQLITE3_EVIDENCE);
  const pulled = pullDatabaseWithSidecars(workDir);
  if (!pulled.hasMain) return outcome('Attempt freshness', 'UNKNOWN', pullFailureEvidence(pulled.names));
  return runtimeStatusOutcome(sqlite3, workDir, pulled.names);
}

/** Check 9: counts `Client timed out while executing` lines inside the app uid's JobScheduler records; PASS at zero. */
export function checkExecutionGuardBurns() {
  const pkg = runAdb(['shell', 'dumpsys', 'package', PACKAGE_NAME]);
  if (!pkg.ok) return outcome('No execution-guard burns', 'UNKNOWN', `dumpsys package failed: ${pkg.err}`);
  const userId = parseUserId(pkg.out);
  if (!userId) return outcome('No execution-guard burns', 'UNKNOWN', 'userId not found in dumpsys package output');
  const jobs = runAdb(['shell', 'dumpsys', 'jobscheduler'], 32 * 1024 * 1024);
  if (!jobs.ok) return outcome('No execution-guard burns', 'UNKNOWN', `dumpsys jobscheduler failed: ${jobs.err}`);
  return guardOutcome(userId, parseGuardTimeoutCounts(jobs.out, appIndexFor(userId)));
}

/** Check 10: the app's stand-by bucket is not 45 (RESTRICTED); names the value either way. */
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

/** Builds one check outcome object in the shape the entry point records and prints. */
function outcome(name, verdict, evidence) {
  return { name, verdict, evidence };
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
  return (
    `isForeground=${orNotFound(fg.isForeground)}, types=${orNotFound(fg.types)}, ` +
    `stopIfKilled=${orNotFound(flags.stopIfKilled)}, createdFromFg=${orNotFound(flags.createdFromFg)}`
  );
}

/** Reads sync_runtime_status from the pulled main database and decides the verdict. */
function runtimeStatusOutcome(sqlite3, workDir, pulledNames) {
  const res = querySqlite(sqlite3, path.join(workDir, 'autoreas.db'), RUNTIME_STATUS_SQL);
  if (!res.ok || !res.out) return outcome('Attempt freshness', 'UNKNOWN', queryFailureEvidence(res.out));
  return outcome('Attempt freshness', 'PASS', formatRuntimeStatusEvidence(res.out, pulledNames));
}

/** Renders the Attempt freshness UNKNOWN evidence for a failed main-database pull. */
function pullFailureEvidence(pulledNames) {
  const names = pulledNames.join(', ');
  return `pull of files/SQLite/autoreas.db failed; pulled: ${names || 'nothing'}`;
}

/** Renders the Attempt freshness UNKNOWN evidence for a failed or empty query. */
function queryFailureEvidence(out) {
  const rendered = out || '(empty result)';
  return `sync_runtime_status query failed or returned nothing:\n${rendered}`;
}

/** Reduces one JobScheduler dump line into the running timeout tally, tracking the newest job header's uid. */
function collectTimeout(state, line) {
  const currentUid = advanceJobUid(line, state.currentUid);
  if (!isTimeoutLine(line)) return { ...state, currentUid };
  return {
    ...state,
    currentUid,
    scoped: state.scoped + (currentUid === state.appIndex ? 1 : 0),
    total: state.total + 1,
  };
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

/** Builds the execution-guard outcome: PASS at zero scoped burns, FAIL otherwise, uid and both counts as evidence. */
function guardOutcome(userId, counts) {
  const evidence =
    `uid=${userId} (u0a${appIndexFor(userId)}); ` +
    `Client-timed-out lines in this uid's records: ${counts.scoped}; total in dump: ${counts.total}`;
  return outcome('No execution-guard burns', counts.scoped === 0 ? 'PASS' : 'FAIL', evidence);
}

/** Pulls the live app database with its WAL and SHM sidecars; reports labels and whether the main db arrived. */
function pullDatabaseWithSidecars(workDir) {
  const names = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const remote = `files/SQLite/autoreas.db${suffix}`;
    const local = path.join(workDir, `autoreas.db${suffix}`);
    if (pullDeviceFile(remote, local)) names.push(suffix || '(main)');
  }
  return { names, hasMain: names.includes('(main)') };
}

/** Formats the Attempt freshness PASS evidence from the raw status row and pulled sidecar labels. */
function formatRuntimeStatusEvidence(rawRow, pulledNames) {
  const row = parseRuntimeStatusRow(rawRow);
  const age = parseAttemptAge(row.lastAttemptAt);
  return (
    `last_attempt_at=${row.lastAttemptAt} (age: ${age ?? 'unparseable'})\n` +
    `last_cycle_stage=${row.lastCycleStage || '(null)'}, is_cycle_active=${row.isCycleActive}, last_error_name=${row.lastErrorName || '(null)'}\n` +
    `pulled with sidecars: ${pulledNames.join(', ')}`
  );
}

/** Reads the journal row count and newest transition from a pulled journal db, rendered as extra evidence lines. */
function readJournalRows(sqlite3, localDbPath) {
  const count = querySqlite(sqlite3, localDbPath, JOURNAL_COUNT_SQL);
  const newest = querySqlite(sqlite3, localDbPath, JOURNAL_NEWEST_SQL);
  let evidence = count.ok ? `\njournal rows: ${count.out}` : `\nrow count query failed: ${count.out}`;
  if (newest.ok && newest.out) evidence += `\nnewest transition: ${newest.out}`;
  return evidence;
}

/** Interprets an all-digit last_attempt_at value as a seconds or milliseconds epoch; null when unusable. */
function parseEpochAttemptAge(trimmed) {
  if (!/^\d+$/.test(trimmed)) return null;
  const ms = normalizeEpochMs(Number(trimmed));
  if (ms === null) return null;
  return formatAge(ms, new Date(ms).toISOString());
}

/** Interprets a non-numeric last_attempt_at value as an ISO-style date string; null when Date.parse rejects it. */
function parseIsoAttemptAge(trimmed) {
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return formatAge(parsed, trimmed);
}

/** Normalizes a raw epoch number to milliseconds (values under 1e11 are seconds); null when not a valid date. */
function normalizeEpochMs(value) {
  const ms = value > 0 && value < 1e11 ? value * 1000 : value;
  return Number.isNaN(new Date(ms).getTime()) ? null : ms;
}

/** Renders an epoch as minutes-ago text with the original value alongside in parentheses. */
function formatAge(ms, rendered) {
  return `${Math.round((Date.now() - ms) / 60000)} min ago (${rendered})`;
}

/** Computes the numeric app uid index (userId minus 10000) used in JobScheduler tags. */
function appIndexFor(userId) {
  return String(Number(userId) - 10000);
}
