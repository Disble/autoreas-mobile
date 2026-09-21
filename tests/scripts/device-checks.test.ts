/**
 * Focused fixture tests for the device-independent parsing layer of `scripts/lib/device-checks.mjs`.
 *
 * These pin the pid-scoped `[nativeSeam]` acceptance check (check 5) — pid resolution from
 * `pidof -s` output, the pid-scoped logcat argument vector, and warning-line extraction from a
 * scoped dump — and the device-gate keyguard parser (`parseKeyguardState`) that decides whether
 * the attached device is unlocked before any acceptance check is worth running. They need no
 * device and no adb.
 *
 * The module under test is plain ESM (`.mjs`), which Jest's CJS runtime cannot `require`
 * directly; it is transformed to CommonJS in-memory with babel and evaluated, so the real
 * source — not a copy — is what these tests exercise.
 */

import { transformFileSync } from '@babel/core';
import path from 'node:path';

// Type-only re-declaration of the three helpers this fixture consumes. Babel erases it, so the
// CJS runtime never requires the `.mjs`; static analysis (fallow) still sees the named imports,
// which keeps the exports counted as consumed by this test.
import type {
  parseKeyguardState as ParseKeyguardState,
  parseNativeSeamWarnings as ParseNativeSeamWarnings,
  parsePidOfOutput as ParsePidOfOutput,
  scopedLogcatArgs as ScopedLogcatArgs,
} from '../../scripts/lib/device-checks.mjs';

/** The check-5 parsing surface plus the device-gate keyguard parser, typed from the statically imported helper values. */
type DeviceChecks = {
  parseKeyguardState: typeof ParseKeyguardState;
  parseNativeSeamWarnings: typeof ParseNativeSeamWarnings;
  parsePidOfOutput: typeof ParsePidOfOutput;
  scopedLogcatArgs: typeof ScopedLogcatArgs;
};

/** Loads `scripts/lib/device-checks.mjs` by transforming it to CJS and evaluating it. */
function loadDeviceChecksModule(): DeviceChecks {
  const file = path.resolve(__dirname, '../../scripts/lib/device-checks.mjs');
  const result = transformFileSync(file, {
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const { code } = result ?? {};
  if (!code) throw new Error(`babel produced no code for ${file}`);
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports as DeviceChecks;
}

/** The real parsing surface of check 5, loaded from source. */
const { parseKeyguardState, parseNativeSeamWarnings, parsePidOfOutput, scopedLogcatArgs } = loadDeviceChecksModule();

/** A realistic `logcat -d -v time --pid=<pid>` dump with one fresh seam warning from the current pid. */
const SCOPED_DUMP_FRESH_WARNING = [
  '09-01 10:00:00.001  1234  1234 D NativeSeam: process started, pid 1234',
  "09-01 10:00:00.500  1234  1234 W NativeSeam: [nativeSeam] requireOptionalNativeModule returned null for 'ForegroundSyncTicker'",
  '09-01 10:00:01.000  1234  1234 I ReactNativeJS: Running "autoreasmobile"',
].join('\n');

/** A scoped dump with no seam warning from the current pid (the stale-warning scenario is excluded by the pid filter itself). */
const SCOPED_DUMP_CLEAN = [
  '09-01 10:00:00.001  1234  1234 D NativeSeam: process started, pid 1234',
  '09-01 10:00:01.000  1234  1234 I ReactNativeJS: Running "autoreasmobile"',
].join('\n');

describe('device gate keyguard parsing', () => {
  /** A `dumpsys window` excerpt with the keyguard up (the state the locked tablet is found in). */
  const WINDOW_DUMP_LOCKED_KEYGUARD = [
    '  mDreamingLockscreen=false',
    '  isKeyguardShowing=true isKeyguardOccluded=false',
  ].join('\n');

  /** A `dumpsys window` excerpt where the lockscreen dream flag is up instead of the keyguard flag. */
  const WINDOW_DUMP_LOCKED_DREAM = [
    '  isKeyguardShowing=false',
    '  mDreamingLockscreen=true',
  ].join('\n');

  /** A `dumpsys window` excerpt reporting the device awake and unlocked. */
  const WINDOW_DUMP_UNLOCKED = [
    '  isKeyguardShowing=false',
    '  mDreamingLockscreen=false',
  ].join('\n');

  /** A dump missing both keyguard booleans, as when the flags move between Android versions. */
  const WINDOW_DUMP_NO_KEYGUARD_FLAGS = [
    '  mSystemReady=true',
    '  mDisplayEnabled=true',
  ].join('\n');

  it('reports locked when isKeyguardShowing=true', () => {
    expect(parseKeyguardState(WINDOW_DUMP_LOCKED_KEYGUARD)).toEqual({
      keyguardShowing: 'true',
      dreamingLockscreen: 'false',
      locked: true,
    });
  });

  it('reports locked when mDreamingLockscreen=true even with the keyguard flag false', () => {
    expect(parseKeyguardState(WINDOW_DUMP_LOCKED_DREAM)).toEqual({
      keyguardShowing: 'false',
      dreamingLockscreen: 'true',
      locked: true,
    });
  });

  it('reports unlocked only when both booleans read false', () => {
    expect(parseKeyguardState(WINDOW_DUMP_UNLOCKED)).toEqual({
      keyguardShowing: 'false',
      dreamingLockscreen: 'false',
      locked: false,
    });
  });

  it('returns null when both keyguard booleans are absent so the check can report UNKNOWN, never PASS', () => {
    expect(parseKeyguardState(WINDOW_DUMP_NO_KEYGUARD_FLAGS)).toBeNull();
  });

  it('returns null for a dump that cannot be read (empty or garbage output)', () => {
    expect(parseKeyguardState('')).toBeNull();
    expect(parseKeyguardState('   \n')).toBeNull();
    expect(parseKeyguardState('error: dumpsys window unavailable')).toBeNull();
  });

  it('keeps a partial dump (one boolean false, the other absent) unlocked:false so the check can refuse to PASS', () => {
    expect(parseKeyguardState('  isKeyguardShowing=false')).toEqual({
      keyguardShowing: 'false',
      dreamingLockscreen: null,
      locked: false,
    });
  });

  it('locks the verdict on a true flag even when the other boolean is absent (fail closed)', () => {
    expect(parseKeyguardState('  mDreamingLockscreen=true')).toMatchObject({ locked: true });
  });
});

describe('check 5 pid-scoped logcat parsing', () => {
  describe('parsePidOfOutput', () => {
    it('resolves a single numeric pid from clean pidof -s output', () => {
      expect(parsePidOfOutput('12345\n')).toBe('12345');
    });

    it('resolves a pid surrounded by device shell whitespace', () => {
      expect(parsePidOfOutput('  987 \r\n')).toBe('987');
    });

    it('rejects empty output so an unresolved pid never scopes the check', () => {
      expect(parsePidOfOutput('')).toBeNull();
      expect(parsePidOfOutput('   \n')).toBeNull();
    });

    it('rejects non-numeric output such as shell error text', () => {
      expect(parsePidOfOutput('/system/bin/sh: pidof: not found')).toBeNull();
    });

    it('rejects multiple pids because a scoped read must bind to one live process', () => {
      expect(parsePidOfOutput('123 456')).toBeNull();
    });
  });

  describe('scopedLogcatArgs', () => {
    it('scopes the dump to the resolved pid via --pid so stale lines from other pids are excluded', () => {
      expect(scopedLogcatArgs('12345')).toEqual(['logcat', '-d', '-v', 'time', '--pid=12345']);
    });
  });

  describe('parseNativeSeamWarnings', () => {
    it('keeps a fresh [nativeSeam] warning emitted by the current process', () => {
      const lines = parseNativeSeamWarnings(SCOPED_DUMP_FRESH_WARNING);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('[nativeSeam]');
    });

    it('returns nothing for a clean scoped dump (absence stays a PASS)', () => {
      expect(parseNativeSeamWarnings(SCOPED_DUMP_CLEAN)).toEqual([]);
    });

    it('extracts every warning line, not just the first, for FAIL evidence', () => {
      const dump = `${SCOPED_DUMP_FRESH_WARNING}\n09-01 10:00:02.000  1234  1234 W NativeSeam: [nativeSeam] seam 'journal' degraded`;
      const lines = parseNativeSeamWarnings(dump);
      expect(lines).toHaveLength(2);
    });
  });
});
