// SQLite-backed acceptance evidence for the device sync verifier.
//
// This module is the base layer under `scripts/lib/device-checks.mjs`: the shared outcome
// builder, the host-`sqlite3` plumbing (executable resolution, read-only queries, database
// pulls through `run-as cat`), and the checks that read only pulled databases — Attempt
// freshness and the Cycle-closure acceptance metric. It never spawns adb itself, so
// `device-checks.mjs` can import from here without an import cycle; the mixed adb+sqlite
// checks (Journal written, Engine invoked's gate read) stay there and call across.
//
// The split exists because `device-checks.mjs` sits at the 500-line hard limit and the new
// cycle-closure check could not fit; the DB-reading half is the cohesive extraction.
//
// No dependencies. Host `sqlite3` is optional: the DB-backed checks degrade to UNKNOWN or
// existence-only when missing, because reading a live database is evidence collection,
// not an acceptance failure.

import { spawnSync } from 'node:child_process';
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
/** Evidence text for Attempt freshness when host sqlite3 is unavailable. */
const NO_SQLITE3_EVIDENCE = 'host sqlite3 not found; sync_runtime_status cannot be read. Install sqlite3 (SDK platform-tools) to lift this.';
/** Read-only query for the newest sync_runtime_status row. */
const RUNTIME_STATUS_SQL = 'SELECT last_attempt_at, last_cycle_stage, is_cycle_active, last_error_name FROM sync_runtime_status ORDER BY id DESC LIMIT 1;';
/** Read-only query for the newest bridge_config row: the T6 presence gate refuses every tick when any of the three coordinates is missing. */
const BRIDGE_CONFIG_GATE_SQL = 'SELECT ip, port, token FROM bridge_config ORDER BY id DESC LIMIT 1;';
/** Read-only query for the cycle-closure telemetry on the newest sync_runtime_status row. */
const CYCLE_STATUS_SQL = 'SELECT is_cycle_active, consecutive_unclosed_cycles, last_cycle_id, last_cycle_stage FROM sync_runtime_status ORDER BY id DESC LIMIT 1;';
/** Read-only query for every journal cycle whose newest transition is non-terminal (`closed`, `failed` and `abandoned` are the attempt FSM's terminal states). */
const JOURNAL_OPEN_CYCLES_SQL = "SELECT cycle_id, to_state FROM journal WHERE id IN (SELECT MAX(id) FROM journal GROUP BY cycle_id) AND to_state NOT IN ('closed', 'failed', 'abandoned') ORDER BY id;";

/** Builds one check outcome object in the shape the entry point records and prints; shared by both check modules. */
export function outcome(name, verdict, evidence) {
  return { name, verdict, evidence };
}

/** Resolves the host sqlite3 executable (PATH, then known SDK locations); null when none answers `--version`. */
export function resolveSqlite3() {
  const candidates = ['sqlite3', ...SQLITE3_KNOWN_PATHS];
  for (const exe of candidates) {
    if (spawnSync(exe, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).status === 0) return exe;
  }
  return null;
}

/**
 * Pulls one file off the app's private storage via `adb exec-out run-as ... cat` into a
 * host path. Binary-safe, read-only on the device; true when the pull produced a file.
 */
export function pullDeviceFile(remotePath, hostPath) {
  const res = spawnSync(ADB, ['exec-out', 'run-as', PACKAGE_NAME, 'cat', remotePath], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0 || !res.stdout || res.stdout.length === 0) return false;
  writeFileSync(hostPath, res.stdout);
  return true;
}

/** Runs one read-only SQL statement against a pulled database file; `{ok, out}` with raw sqlite3 stdout. */
export function querySqlite(exe, dbPath, sql) {
  const res = spawnSync(exe, ['-readonly', dbPath, sql], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return { ok: res.status === 0, out: (res.stdout ?? '').trim() };
}

/** Check 9: pulls the live app database (plus WAL/SHM) and reads sync_runtime_status; missing sqlite3 is UNKNOWN, not FAIL. */
export function checkAttemptFreshness(sqlite3, workDir) {
  if (!sqlite3) return outcome('Attempt freshness', 'UNKNOWN', NO_SQLITE3_EVIDENCE);
  const pulled = pullDatabaseWithSidecars(workDir);
  if (!pulled.hasMain) return outcome('Attempt freshness', 'UNKNOWN', pullFailureEvidence(pulled.names));
  return runtimeStatusOutcome(sqlite3, workDir, pulled.names);
}

/** Check 10: the primary acceptance metric of docs/mobile-sync-architecture.md §9 — `consecutive_unclosed_cycles = 0`.
 * Reads the newest sync_runtime_status row plus every journal cycle whose newest transition is non-terminal; FAIL
 * names the counter value and the offending cycle ids; missing sqlite3 or unreadable databases degrade to UNKNOWN. */
export function checkCycleClosure(sqlite3, workDir) {
  if (!sqlite3) return outcome('Cycle closure', 'UNKNOWN', NO_SQLITE3_EVIDENCE);
  const pulled = pullDatabaseWithSidecars(workDir);
  if (!pulled.hasMain) return outcome('Cycle closure', 'UNKNOWN', pullFailureEvidence(pulled.names));
  const res = querySqlite(sqlite3, path.join(workDir, 'autoreas.db'), CYCLE_STATUS_SQL);
  if (!res.ok || !res.out) {
    return outcome('Cycle closure', 'UNKNOWN', `sync_runtime_status cycle telemetry query failed or returned nothing:\n${res.out || '(empty result)'}`);
  }
  return cycleClosureOutcome(parseCycleStatusRow(res.out), readOpenJournalCycles(sqlite3, workDir));
}

/** Reads the newest bridge_config row from the pulled app database for check 7's T6 presence-gate awareness:
 * `{config, error}` — error is set (config null) when sqlite3 is missing, the pull fails, or the query itself
 * fails. An empty result is NOT an error: no row means the probe refuses, exactly like an incomplete row. */
export function readBridgeGateConfig(sqlite3, workDir) {
  if (!sqlite3) return { config: null, error: NO_SQLITE3_EVIDENCE };
  const pulled = pullDatabaseWithSidecars(workDir);
  if (!pulled.hasMain) return { config: null, error: pullFailureEvidence(pulled.names) };
  const res = querySqlite(sqlite3, path.join(workDir, 'autoreas.db'), BRIDGE_CONFIG_GATE_SQL);
  if (!res.ok) return { config: null, error: `bridge_config query failed:\n${res.out || '(no output)'}` };
  return { config: parseBridgeConfigRow(res.out), error: null };
}

/** Splits one pipe-delimited bridge_config row into its three gate coordinates, '' for missing columns. */
export function parseBridgeConfigRow(out) {
  const [ip = '', port = '', token = ''] = out.split('|');
  return { ip, port, token };
}

/** Splits one pipe-delimited cycle telemetry row into its named fields, '' for missing columns. */
export function parseCycleStatusRow(out) {
  const [isCycleActive = '', consecutiveUnclosedCycles = '', lastCycleId = '', lastCycleStage = ''] = out.split('|');
  return { isCycleActive, consecutiveUnclosedCycles, lastCycleId, lastCycleStage };
}

/** Parses the open-cycle query output (`cycle_id|to_state` lines) into {cycleId, toState} pairs; [] when none. */
export function parseOpenJournalCycles(out) {
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [cycleId = '', toState = ''] = line.split('|');
      return { cycleId, toState };
    });
}

/** Builds the Cycle closure verdict from the newest runtime-status row and the journal read: FAIL when
 * `consecutive_unclosed_cycles > 0` (naming the counter and the offending cycle ids) or when
 * `is_cycle_active = 1` with no attempt actually in flight; PASS otherwise; UNKNOWN when the counter
 * itself is unparseable, so a broken read can never manufacture a green metric. */
export function cycleClosureOutcome(statusRow, journal) {
  const counter = Number.parseInt(statusRow.consecutiveUnclosedCycles, 10);
  if (Number.isNaN(counter)) {
    return outcome('Cycle closure', 'UNKNOWN', `consecutive_unclosed_cycles is unparseable: '${statusRow.consecutiveUnclosedCycles}'`);
  }
  if (counter > 0) return cycleClosureFailure(counter, statusRow, journal);
  if (statusRow.isCycleActive === '1' && !attemptInFlight(statusRow, journal)) {
    return outcome('Cycle closure', 'FAIL',
      `is_cycle_active=1 with no attempt actually in flight — the active flag is stuck (last_cycle_id=${statusRow.lastCycleId || '(null)'}, last_cycle_stage=${statusRow.lastCycleStage || '(null)'}).\n${journalEvidence(journal)}`);
  }
  const inFlight = statusRow.isCycleActive === '1' ? 'attempt in flight' : 'no attempt in flight';
  return outcome('Cycle closure', 'PASS',
    `consecutive_unclosed_cycles=${counter} (metric requires 0), is_cycle_active=${statusRow.isCycleActive} (${inFlight})\n${journalEvidence(journal)}`);
}

/** Builds the Cycle closure FAIL evidence for a non-zero unclosed counter: the counter value, the offending
 * cycle ids with their newest (non-terminal) states, and the runtime row the counter was read from. */
function cycleClosureFailure(counter, statusRow, journal) {
  const offenders = journal.readable && journal.openCycles.length > 0
    ? journal.openCycles.map((cycle) => `${cycle.cycleId} (newest transition: ${cycle.toState})`).join(', ')
    : `not enumerable — ${journal.note ?? 'the journal holds no open cycle'}`;
  return outcome('Cycle closure', 'FAIL',
    `consecutive_unclosed_cycles=${counter} (the acceptance metric requires 0 — docs/mobile-sync-architecture.md §9).\n` +
    `Offending cycle ids: ${offenders}\n` +
    `is_cycle_active=${statusRow.isCycleActive}, last_cycle_id=${statusRow.lastCycleId || '(null)'}, last_cycle_stage=${statusRow.lastCycleStage || '(null)'}`);
}

/** Tells whether an attempt is actually in flight: the journal proves it whenever it holds any
 * non-terminal cycle; with an unreadable or empty journal the newest recorded stage stands in
 * (anything other than '' or the terminal 'closed' stage). */
function attemptInFlight(statusRow, journal) {
  if (journal.readable && journal.rowCount !== null && journal.rowCount > 0) return journal.openCycles.length > 0;
  const stage = statusRow.lastCycleStage;
  return stage !== '' && stage !== 'closed';
}

/** Renders the journal read as a Cycle closure evidence line, naming what could and could not be proven. */
function journalEvidence(journal) {
  if (!journal.readable) return `journal unreadable (${journal.note}) — offending cycles could not be enumerated from the FSM`;
  if (journal.rowCount === 0) return 'journal is empty (no transitions recorded — the SyncJournal seam may be a no-op; see check 5)';
  if (journal.openCycles.length === 0) return `every journal cycle's newest transition is terminal (${journal.rowCount} row(s))`;
  return `non-terminal journal cycles: ${journal.openCycles.map((cycle) => `${cycle.cycleId} (${cycle.toState})`).join(', ')}`;
}

/** Pulls the journal database and reads its row count plus every cycle whose newest transition is
 * non-terminal; `{readable, rowCount, openCycles, note}` with note set when unreadable. */
function readOpenJournalCycles(sqlite3, workDir) {
  const local = path.join(workDir, 'sync-journal.db');
  if (!pullDeviceFile('files/sync-journal.db', local)) {
    return { readable: false, rowCount: null, openCycles: [], note: 'pull of files/sync-journal.db failed' };
  }
  const count = querySqlite(sqlite3, local, 'SELECT COUNT(*) FROM journal;');
  const open = querySqlite(sqlite3, local, JOURNAL_OPEN_CYCLES_SQL);
  if (!open.ok) {
    return { readable: false, rowCount: null, openCycles: [], note: `journal open-cycle query failed: ${open.out}` };
  }
  return { readable: true, rowCount: count.ok ? Number.parseInt(count.out, 10) : null, openCycles: parseOpenJournalCycles(open.out), note: null };
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

/** Formats the Attempt freshness PASS evidence from the raw status row and pulled sidecar labels. */
function formatRuntimeStatusEvidence(rawRow, pulledNames) {
  const row = parseRuntimeStatusRow(rawRow);
  const age = parseAttemptAge(row.lastAttemptAt);
  return `last_attempt_at=${row.lastAttemptAt} (age: ${age ?? 'unparseable'})\n` +
    `last_cycle_stage=${row.lastCycleStage || '(null)'}, is_cycle_active=${row.isCycleActive}, last_error_name=${row.lastErrorName || '(null)'}\n` +
    `pulled with sidecars: ${pulledNames.join(', ')}`;
}

/** Splits one pipe-delimited sync_runtime_status row into its named fields, '' for missing columns. */
function parseRuntimeStatusRow(out) {
  const [lastAttemptAt = '', lastCycleStage = '', isCycleActive = '', lastErrorName = ''] = out.split('|');
  return { lastAttemptAt, lastCycleStage, isCycleActive, lastErrorName };
}

/** Turns a raw last_attempt_at value into a human age (seconds/ms epochs, ISO strings); null when unparseable. */
function parseAttemptAge(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return null;
  return parseEpochAttemptAge(trimmed) ?? parseIsoAttemptAge(trimmed);
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
