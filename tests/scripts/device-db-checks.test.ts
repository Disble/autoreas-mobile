/**
 * Focused fixture tests for the SQLite-backed layer of `scripts/lib/device-db-checks.mjs`.
 *
 * These pin the pure parsing and verdict pieces of the DB-backed acceptance checks: the
 * bridge-config row reader behind check 7's T6 presence-gate awareness, and the cycle-closure
 * metric of `docs/mobile-sync-architecture.md` §9 (check 10) -- read from the native journal's
 * per-cycle newest transitions. They need no device, no adb and no sqlite3.
 *
 * The module under test is plain ESM (`.mjs`), which Jest's CJS runtime cannot `require`
 * directly; it is transformed to CommonJS in-memory with babel and evaluated, so the real
 * source -- not a copy -- is what these tests exercise.
 */

import { transformFileSync } from '@babel/core';
import path from 'node:path';

// Type-only re-declaration of the helpers this fixture consumes. Babel erases it, so the
// CJS runtime never requires the `.mjs`; static analysis (fallow) still sees the named imports,
// which keeps the exports counted as consumed by this test.
import type {
  cycleClosureOutcome as CycleClosureOutcome,
  parseBridgeConfigRow as ParseBridgeConfigRow,
  parseJournalCycles as ParseJournalCycles,
  unfinishedCycleStreak as UnfinishedCycleStreak,
} from '../../scripts/lib/device-db-checks.mjs';

/** The DB-check parsing and verdict surface, typed from the statically imported helper values. */
type DeviceDbChecks = {
  cycleClosureOutcome: typeof CycleClosureOutcome;
  parseBridgeConfigRow: typeof ParseBridgeConfigRow;
  parseJournalCycles: typeof ParseJournalCycles;
  unfinishedCycleStreak: typeof UnfinishedCycleStreak;
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
const { cycleClosureOutcome, parseBridgeConfigRow, parseJournalCycles, unfinishedCycleStreak } =
  loadDeviceDbChecksModule();

/** Builds a readable journal read from `cycle_id|to_state` lines, newest first. */
function journalOf(...lines: string[]) {
  return { readable: true, cycles: parseJournalCycles(lines.join('\n')), note: null };
}

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
  it('parses each journal line into a cycleId/toState pair, keeping the newest-first order', () => {
    expect(parseJournalCycles('cyc-9|sent\ncyc-4|closed')).toEqual([
      { cycleId: 'cyc-9', toState: 'sent' },
      { cycleId: 'cyc-4', toState: 'closed' },
    ]);
  });

  it('returns an empty list for an empty journal so absence stays provable', () => {
    expect(parseJournalCycles('')).toEqual([]);
  });

  it('tolerates CRLF line endings from the device shell', () => {
    expect(parseJournalCycles('cyc-9|sent\r\ncyc-4|claimed\r\n')).toHaveLength(2);
  });
});

describe('check 10 unfinished-cycle streak', () => {
  it('treats a not_applicable cycle as finished: the engine stood down and its FSM marks it terminal', () => {
    expect(unfinishedCycleStreak(journalOf('cyc-3|not_applicable', 'cyc-2|not_applicable', 'cyc-1|closed').cycles)).toEqual([]);
  });

  it('counts abandoned cycles at the head of the journal until the first finished one', () => {
    const streak = unfinishedCycleStreak(
      journalOf('cyc-3|abandoned', 'cyc-2|abandoned', 'cyc-1|closed', 'cyc-0|abandoned').cycles,
    );

    expect(streak.map((cycle) => cycle.cycleId)).toEqual(['cyc-3', 'cyc-2']);
  });

  it('skips the newest cycle while it is non-terminal, because it may be in flight', () => {
    expect(unfinishedCycleStreak(journalOf('cyc-2|sent', 'cyc-1|closed').cycles)).toEqual([]);
  });

  it('counts an older cycle parked in a non-terminal state behind the newest one', () => {
    const streak = unfinishedCycleStreak(journalOf('cyc-3|claimed', 'cyc-2|sent', 'cyc-1|failed').cycles);

    expect(streak).toEqual([{ cycleId: 'cyc-2', toState: 'sent' }]);
  });

  it('treats a failed cycle as finished: it ran to its end and reported why', () => {
    expect(unfinishedCycleStreak(journalOf('cyc-2|failed', 'cyc-1|abandoned').cycles)).toEqual([]);
  });
});

describe('check 10 cycle-closure verdicts', () => {
  it('FAILs with the streak length and the offending cycle ids when the newest cycles never finished', () => {
    const outcome = cycleClosureOutcome(journalOf('cyc-9|abandoned', 'cyc-8|abandoned', 'cyc-7|closed'));

    expect(outcome.verdict).toBe('FAIL');
    expect(outcome.evidence).toContain('unfinished cycles=2');
    expect(outcome.evidence).toContain('cyc-9 (newest transition: abandoned)');
    expect(outcome.evidence).toContain('cyc-8 (newest transition: abandoned)');
    expect(outcome.evidence).not.toContain('cyc-7 (newest transition');
  });

  it('PASSes when the newest cycle closed, naming it', () => {
    const outcome = cycleClosureOutcome(journalOf('cyc-7|closed', 'cyc-6|abandoned'));

    expect(outcome.verdict).toBe('PASS');
    expect(outcome.evidence).toContain('unfinished cycles=0');
    expect(outcome.evidence).toContain('newest cycle: cyc-7 (closed)');
  });

  it('PASSes while the newest cycle is in flight and the one before it finished', () => {
    const outcome = cycleClosureOutcome(journalOf('cyc-9|sent', 'cyc-8|closed'));

    expect(outcome.verdict).toBe('PASS');
    expect(outcome.evidence).toContain('newest cycle: cyc-9 (sent)');
  });

  it('is UNKNOWN for an empty journal, so no transitions never read as a green metric', () => {
    const outcome = cycleClosureOutcome(journalOf());

    expect(outcome.verdict).toBe('UNKNOWN');
    expect(outcome.evidence).toContain('journal is empty');
  });

  it('is UNKNOWN when the journal could not be read, naming why', () => {
    const outcome = cycleClosureOutcome({
      readable: false,
      cycles: [],
      note: 'pull of files/sync-journal.db failed',
    });

    expect(outcome.verdict).toBe('UNKNOWN');
    expect(outcome.evidence).toContain('pull of files/sync-journal.db failed');
  });
});
