/**
 * Focused fixture tests for the SQLite-backed layer of `scripts/lib/device-db-checks.mjs`.
 *
 * These pin the pure parsing and verdict pieces of the DB-backed acceptance checks: the
 * bridge-config row reader behind check 7's T6 presence-gate awareness, and the cycle-closure
 * metric of `docs/mobile-sync-architecture.md` §9 (check 10) — the newest
 * `sync_runtime_status` telemetry row and the journal's per-cycle newest transitions. They
 * need no device, no adb and no sqlite3.
 *
 * The module under test is plain ESM (`.mjs`), which Jest's CJS runtime cannot `require`
 * directly; it is transformed to CommonJS in-memory with babel and evaluated, so the real
 * source — not a copy — is what these tests exercise.
 */

import { transformFileSync } from '@babel/core';
import path from 'node:path';

// Type-only re-declaration of the helpers this fixture consumes. Babel erases it, so the
// CJS runtime never requires the `.mjs`; static analysis (fallow) still sees the named imports,
// which keeps the exports counted as consumed by this test.
import type {
  cycleClosureOutcome as CycleClosureOutcome,
  parseBridgeConfigRow as ParseBridgeConfigRow,
  parseCycleStatusRow as ParseCycleStatusRow,
  parseOpenJournalCycles as ParseOpenJournalCycles,
} from '../../scripts/lib/device-db-checks.mjs';

/** The DB-check parsing and verdict surface, typed from the statically imported helper values. */
type DeviceDbChecks = {
  cycleClosureOutcome: typeof CycleClosureOutcome;
  parseBridgeConfigRow: typeof ParseBridgeConfigRow;
  parseCycleStatusRow: typeof ParseCycleStatusRow;
  parseOpenJournalCycles: typeof ParseOpenJournalCycles;
};

/** Loads `scripts/lib/device-db-checks.mjs` by transforming it to CJS and evaluating it. */
function loadDeviceDbChecksModule(): DeviceDbChecks {
  const file = path.resolve(__dirname, '../../scripts/lib/device-db-checks.mjs');
  const result = transformFileSync(file, {
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const { code } = result ?? {};
  if (!code) throw new Error(`babel produced no code for ${file}`);
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports as DeviceDbChecks;
}

/** The real DB-check surface, loaded from source. */
const { cycleClosureOutcome, parseBridgeConfigRow, parseCycleStatusRow, parseOpenJournalCycles } =
  loadDeviceDbChecksModule();

/** A journal read that proves an attempt is in flight: rows exist and one cycle is non-terminal. */
const JOURNAL_IN_FLIGHT = {
  readable: true,
  rowCount: 4,
  openCycles: [{ cycleId: 'cyc-9', toState: 'sent' }],
  note: null,
};

/** A journal read that proves no attempt is in flight: rows exist and every newest transition is terminal. */
const JOURNAL_ALL_CLOSED = { readable: true, rowCount: 7, openCycles: [], note: null };

/** A journal read with no evidence at all: the database holds no transitions. */
const JOURNAL_EMPTY = { readable: true, rowCount: 0, openCycles: [], note: null };

/** A journal read that failed, so nothing about in-flight state can be proven from the FSM. */
const JOURNAL_UNREADABLE = { readable: false, rowCount: null, openCycles: [], note: 'pull of files/sync-journal.db failed' };

describe('check 7 presence-gate bridge config parsing', () => {
  it('splits a complete pipe-delimited bridge_config row into its three gate coordinates', () => {
    expect(parseBridgeConfigRow('192.168.1.10|8787|secret-token')).toEqual({
      ip: '192.168.1.10',
      port: '8787',
      token: 'secret-token',
    });
  });

  it('yields empty strings for missing columns so an incomplete row reads as gate refusal', () => {
    expect(parseBridgeConfigRow('192.168.1.10||')).toEqual({ ip: '192.168.1.10', port: '', token: '' });
  });

  it('treats an empty query result as a fully absent config (the probe refuses an unpaired app)', () => {
    expect(parseBridgeConfigRow('')).toEqual({ ip: '', port: '', token: '' });
  });
});

describe('check 10 cycle-closure parsing', () => {
  it('splits the newest sync_runtime_status cycle row into its named telemetry fields', () => {
    expect(parseCycleStatusRow('1|3|cyc-7|http')).toEqual({
      isCycleActive: '1',
      consecutiveUnclosedCycles: '3',
      lastCycleId: 'cyc-7',
      lastCycleStage: 'http',
    });
  });

  it('yields empty strings for missing columns instead of guessing defaults', () => {
    expect(parseCycleStatusRow('0|0')).toEqual({
      isCycleActive: '0',
      consecutiveUnclosedCycles: '0',
      lastCycleId: '',
      lastCycleStage: '',
    });
  });

  it('parses each open-cycle line into a cycleId/toState pair', () => {
    expect(parseOpenJournalCycles('cyc-9|sent\ncyc-4|claimed')).toEqual([
      { cycleId: 'cyc-9', toState: 'sent' },
      { cycleId: 'cyc-4', toState: 'claimed' },
    ]);
  });

  it('returns an empty list for a journal with no non-terminal cycle so absence stays provable', () => {
    expect(parseOpenJournalCycles('')).toEqual([]);
  });

  it('tolerates CRLF line endings from the device shell', () => {
    expect(parseOpenJournalCycles('cyc-9|sent\r\ncyc-4|claimed\r\n')).toHaveLength(2);
  });
});

describe('check 10 cycle-closure verdicts', () => {
  it('FAILs with the counter value and the offending cycle ids when consecutive_unclosed_cycles > 0', () => {
    const outcome = cycleClosureOutcome(
      parseCycleStatusRow('0|2|cyc-9|sent'),
      JOURNAL_IN_FLIGHT,
    );
    expect(outcome.verdict).toBe('FAIL');
    expect(outcome.evidence).toContain('consecutive_unclosed_cycles=2');
    expect(outcome.evidence).toContain('cyc-9');
    expect(outcome.evidence).toContain('sent');
  });

  it('FAILs on the counter alone when the journal is unreadable, naming the counter and the journal failure', () => {
    const outcome = cycleClosureOutcome(
      parseCycleStatusRow('0|2|cyc-9|sent'),
      JOURNAL_UNREADABLE,
    );
    expect(outcome.verdict).toBe('FAIL');
    expect(outcome.evidence).toContain('consecutive_unclosed_cycles=2');
    expect(outcome.evidence).toContain('pull of files/sync-journal.db failed');
  });

  it('PASSes the metric when the counter is zero and no cycle is active', () => {
    const outcome = cycleClosureOutcome(
      parseCycleStatusRow('0|0|cyc-7|closed'),
      JOURNAL_ALL_CLOSED,
    );
    expect(outcome.verdict).toBe('PASS');
    expect(outcome.evidence).toContain('consecutive_unclosed_cycles=0');
    expect(outcome.evidence).toContain('is_cycle_active=0');
  });

  it('PASSes with a legitimately in-flight attempt: active flag up and a non-terminal journal cycle', () => {
    const outcome = cycleClosureOutcome(
      parseCycleStatusRow('1|0|cyc-9|sent'),
      JOURNAL_IN_FLIGHT,
    );
    expect(outcome.verdict).toBe('PASS');
    expect(outcome.evidence).toContain('attempt in flight');
  });

  it('FAILs when is_cycle_active=1 but the journal proves no attempt is in flight (stuck flag)', () => {
    const outcome = cycleClosureOutcome(
      parseCycleStatusRow('1|0|cyc-7|closed'),
      JOURNAL_ALL_CLOSED,
    );
    expect(outcome.verdict).toBe('FAIL');
    expect(outcome.evidence).toContain('is_cycle_active=1');
    expect(outcome.evidence).toContain('no attempt actually in flight');
  });

  it('FAILs on the stage fallback when the journal is empty and the recorded stage is terminal', () => {
    const outcome = cycleClosureOutcome(
      parseCycleStatusRow('1|0|cyc-7|closed'),
      JOURNAL_EMPTY,
    );
    expect(outcome.verdict).toBe('FAIL');
  });

  it('PASSes when the journal is empty but the recorded stage shows a cycle mid-flight', () => {
    const outcome = cycleClosureOutcome(
      parseCycleStatusRow('1|0|cyc-9|claim_ops'),
      JOURNAL_EMPTY,
    );
    expect(outcome.verdict).toBe('PASS');
  });

  it('degrades to UNKNOWN when the counter itself is unparseable, never PASS', () => {
    const outcome = cycleClosureOutcome(
      parseCycleStatusRow('1||cyc-9|sent'),
      JOURNAL_IN_FLIGHT,
    );
    expect(outcome.verdict).toBe('UNKNOWN');
    expect(outcome.evidence).toContain('unparseable');
  });
});
