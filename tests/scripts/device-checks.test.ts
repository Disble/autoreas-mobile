/**
 * Focused fixture tests for the pid-scoped `[nativeSeam]` acceptance check (check 5).
 *
 * These pin the device-independent parsing layer of `scripts/lib/device-checks.mjs`:
 * pid resolution from `pidof -s` output, the pid-scoped logcat argument vector, and
 * warning-line extraction from a scoped dump. They need no device and no adb.
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
  parseNativeSeamWarnings as ParseNativeSeamWarnings,
  parsePidOfOutput as ParsePidOfOutput,
  scopedLogcatArgs as ScopedLogcatArgs,
} from '../../scripts/lib/device-checks.mjs';

/** The check-5 parsing surface of the module, typed from the statically imported helper values. */
type DeviceChecks = {
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
const { parseNativeSeamWarnings, parsePidOfOutput, scopedLogcatArgs } = loadDeviceChecksModule();

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
