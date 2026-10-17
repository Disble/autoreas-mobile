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
const RUNTIME_STATUS_SQL = 'SELECT last_attempt_at, last_cycle_stage, last_cycle_id, last_error_name FROM sync_runtime_status ORDER BY id DESC LIMIT 1;';
/** Read-only query for the newest bridge_config row: the T6 presence gate refuses every tick when any of the three coordinates is missing. */
const BRIDGE_CONFIG_GATE_SQL = 'SELECT ip, port, token FROM bridge_config ORDER BY id DESC LIMIT 1;';
/** Read-only query for every journal cycle's newest transition, newest cycle first. */
const JOURNAL_CYCLES_SQL = 'SELECT cycle_id, to_state FROM journal WHERE id IN (SELECT MAX(id) FROM journal GROUP BY cycle_id) ORDER BY id DESC;';
/** The journal states that finish a cycle: it closed, failed and reported why, or stood down as `not_applicable` (terminal in the engine's FSM). */
const FINISHED_CYCLE_STATES = new Set(['closed', 'failed', 'not_applicable']);

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

/** Check 10: the primary acceptance metric of docs/mobile-sync-architecture.md §9 — no unfinished cycles.
 * Reads the native journal only: a cycle that never finished is one the engine marked `abandoned`, or one
 * still parked in a non-terminal state that is not the newest (possibly in-flight) cycle. FAIL names the
 * offending cycle ids; missing sqlite3 or an unreadable journal degrade to UNKNOWN. */
export function checkCycleClosure(sqlite3, workDir) {
  if (!sqlite3) return outcome('Cycle closure', 'UNKNOWN', NO_SQLITE3_EVIDENCE);
  return cycleClosureOutcome(readJournalCycles(sqlite3, workDir));
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

/** Parses the journal query output (`cycle_id|to_state` lines, newest first) into {cycleId, toState} pairs; [] when none. */
export function parseJournalCycles(out) {
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [cycleId = '', toState = ''] = line.split('|');
      return { cycleId, toState };
    });
}

/** Counts the unfinished cycles at the head of the journal, newest first, stopping at the first finished
 * one -- the same streak the retired `consecutive_unclosed_cycles` counter measured. The newest cycle is
 * skipped while it is still non-terminal, because it may be the attempt in flight right now. */
export function unfinishedCycleStreak(cycles) {
  const [newest, ...older] = cycles;
  const isNewestInFlight = newest !== undefined && newest.toState !== 'abandoned' && !FINISHED_CYCLE_STATES.has(newest.toState);
  const streak = [];
  for (const cycle of isNewestInFlight ? older : cycles) {
    if (FINISHED_CYCLE_STATES.has(cycle.toState)) break;
    streak.push(cycle);
  }
  return streak;
}

/** Builds the Cycle closure verdict from the journal read: FAIL when the newest cycles never finished
 * (naming them), PASS otherwise, UNKNOWN when the journal is unreadable or empty, so a broken or absent
 * read can never manufacture a green metric. */
export function cycleClosureOutcome(journal) {
  if (!journal.readable) {
    return outcome('Cycle closure', 'UNKNOWN', `journal unreadable (${journal.note}) — cycle closure cannot be proven`);
  }
  if (journal.cycles.length === 0) {
    return outcome('Cycle closure', 'UNKNOWN', 'journal is empty (no transitions recorded — the SyncJournal seam may be a no-op; see check 5)');
  }
  const streak = unfinishedCycleStreak(journal.cycles);
  const newest = journal.cycles[0];
  const newestLine = `newest cycle: ${newest.cycleId} (${newest.toState})`;
  if (streak.length > 0) {
    const offenders = streak.map((cycle) => `${cycle.cycleId} (newest transition: ${cycle.toState})`).join(', ');
    return outcome('Cycle closure', 'FAIL',
      `unfinished cycles=${streak.length} (the acceptance metric requires 0 — docs/mobile-sync-architecture.md §9).\n` +
      `Offending cycle ids: ${offenders}\n${newestLine}`);
  }
  return outcome('Cycle closure', 'PASS',
    `unfinished cycles=0 (metric requires 0) across ${journal.cycles.length} journal cycle(s)\n${newestLine}`);
}

/** Pulls the journal database and reads every cycle's newest transition, newest first;
 * `{readable, cycles, note}` with note set when unreadable. */
function readJournalCycles(sqlite3, workDir) {
  const local = path.join(workDir, 'sync-journal.db');
  if (!pullDeviceFile('files/sync-journal.db', local)) {
    return { readable: false, cycles: [], note: 'pull of files/sync-journal.db failed' };
  }
  const res = querySqlite(sqlite3, local, JOURNAL_CYCLES_SQL);
  if (!res.ok) {
    return { readable: false, cycles: [], note: `journal cycle query failed: ${res.out}` };
  }
  return { readable: true, cycles: parseJournalCycles(res.out), note: null };
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
    `last_cycle_stage=${row.lastCycleStage || '(null)'}, last_cycle_id=${row.lastCycleId || '(null)'}, last_error_name=${row.lastErrorName || '(null)'}\n` +
    `pulled with sidecars: ${pulledNames.join(', ')}`;
}

/** Splits one pipe-delimited sync_runtime_status row into its named fields, '' for missing columns. */
function parseRuntimeStatusRow(out) {
  const [lastAttemptAt = '', lastCycleStage = '', lastCycleId = '', lastErrorName = ''] = out.split('|');
  return { lastAttemptAt, lastCycleStage, lastCycleId, lastErrorName };
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
