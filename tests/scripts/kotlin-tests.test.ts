/**
 * Focused fixture tests for the pure decision logic behind the Kotlin-unit-test gate
 * (`scripts/lib/kotlin-tests.mjs`, driven by the thin entry point
 * `scripts/kotlin-unit-tests.mjs`).
 *
 * These pin: the deterministic prebuild-input hash, the `android/` staleness decision (missing
 * vs. stale vs. current), the per-module input resolver, the platform-correct Gradle wrapper
 * choice, and the missing-toolchain description that turns an absent JDK/Android SDK into a
 * clear, non-zero failure instead of a silent skip. They need no real filesystem, no Gradle and
 * no JDK.
 *
 * The module under test is plain ESM (`.mjs`), which Jest's CJS runtime cannot `require`
 * directly; it is transformed to CommonJS in-memory with babel and evaluated, so the real
 * source -- not a copy -- is what these tests exercise (same recipe as
 * `tests/scripts/device-checks.test.ts`).
 */

import { transformFileSync } from '@babel/core';
import path from 'node:path';

// Type-only re-declaration of the helpers this fixture consumes. Babel erases it, so the CJS
// runtime never requires the `.mjs`; static analysis (fallow) still sees the named imports,
// which keeps the exports counted as consumed by this test.
import type {
  buildGradleTestArgs as BuildGradleTestArgs,
  decidePrebuildStatus as DecidePrebuildStatus,
  describeMissingToolchain as DescribeMissingToolchain,
  hashPrebuildInputs as HashPrebuildInputs,
  resolveGradleWrapper as ResolveGradleWrapper,
  resolveModuleInputs as ResolveModuleInputs,
} from '../../scripts/lib/kotlin-tests.mjs';

/** The Kotlin-gate decision surface, typed from the statically imported helper values. */
type KotlinTests = {
  buildGradleTestArgs: typeof BuildGradleTestArgs;
  decidePrebuildStatus: typeof DecidePrebuildStatus;
  describeMissingToolchain: typeof DescribeMissingToolchain;
  hashPrebuildInputs: typeof HashPrebuildInputs;
  resolveGradleWrapper: typeof ResolveGradleWrapper;
  resolveModuleInputs: typeof ResolveModuleInputs;
};

/** Loads `scripts/lib/kotlin-tests.mjs` by transforming it to CJS and evaluating it. */
function loadKotlinTestsModule(): KotlinTests {
  const file = path.resolve(__dirname, '../../scripts/lib/kotlin-tests.mjs');
  const result = transformFileSync(file, {
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const { code } = result ?? {};
  if (!code) throw new Error(`babel produced no code for ${file}`);
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports as KotlinTests;
}

/** The real decision surface, loaded from source. */
const { buildGradleTestArgs, decidePrebuildStatus, describeMissingToolchain, hashPrebuildInputs, resolveGradleWrapper, resolveModuleInputs } =
  loadKotlinTestsModule();

describe('buildGradleTestArgs', () => {
  it('runs both modules\' unit tests THEN both modules\' per-class coverage verify tasks, build cache on, lint tasks omitted by default', () => {
    expect(buildGradleTestArgs()).toEqual([
      ':sync-engine:testDebugUnitTest',
      ':foreground-sync-ticker:testDebugUnitTest',
      ':sync-engine:koverVerifyCore',
      ':sync-engine:koverVerifyImportant',
      ':sync-engine:koverVerifyCoreFloor',
      ':sync-engine:koverVerifyCoreFloorRunner',
      ':foreground-sync-ticker:koverVerifyDebug',
      '--build-cache',
      '--console=plain',
    ]);
  });

  it('appends both modules\' lintDebug tasks, in the SAME invocation, when withLint is true (C3)', () => {
    expect(buildGradleTestArgs({ withLint: true })).toEqual([
      ':sync-engine:testDebugUnitTest',
      ':foreground-sync-ticker:testDebugUnitTest',
      ':sync-engine:koverVerifyCore',
      ':sync-engine:koverVerifyImportant',
      ':sync-engine:koverVerifyCoreFloor',
      ':sync-engine:koverVerifyCoreFloorRunner',
      ':foreground-sync-ticker:koverVerifyDebug',
      ':sync-engine:lintDebug',
      ':foreground-sync-ticker:lintDebug',
      '--build-cache',
      '--console=plain',
    ]);
  });
});

describe('hashPrebuildInputs', () => {
  it('is independent of input order', () => {
    const a = [{ path: 'app.json', content: '{}' }, { path: 'package.json', content: '{"x":1}' }];
    const b = [{ path: 'package.json', content: '{"x":1}' }, { path: 'app.json', content: '{}' }];
    expect(hashPrebuildInputs(a)).toBe(hashPrebuildInputs(b));
  });

  it('changes when any content changes', () => {
    const before = [{ path: 'app.json', content: '{}' }];
    const after = [{ path: 'app.json', content: '{"changed":true}' }];
    expect(hashPrebuildInputs(before)).not.toBe(hashPrebuildInputs(after));
  });

  it('changes when a path is added or removed, even with identical content elsewhere', () => {
    const smaller = [{ path: 'app.json', content: 'same' }];
    const larger = [{ path: 'app.json', content: 'same' }, { path: 'bun.lock', content: 'same' }];
    expect(hashPrebuildInputs(smaller)).not.toBe(hashPrebuildInputs(larger));
  });

  it('produces a 64-character hex sha256 digest, even for an empty input set', () => {
    expect(hashPrebuildInputs([])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('resolveModuleInputs', () => {
  it('keeps only the basenames that exist, per module, sorted by module name', () => {
    const exists = (rel: string) =>
      [
        'modules/foreground-sync-ticker/expo-module.config.json',
        'modules/foreground-sync-ticker/android/build.gradle',
        'modules/sync-engine/expo-module.config.json',
        'modules/sync-engine/android/build.gradle',
      ].includes(rel);
    expect(resolveModuleInputs(['sync-engine', 'foreground-sync-ticker'], exists)).toEqual([
      'modules/foreground-sync-ticker/expo-module.config.json',
      'modules/foreground-sync-ticker/android/build.gradle',
      'modules/sync-engine/expo-module.config.json',
      'modules/sync-engine/android/build.gradle',
    ]);
  });

  it('skips a module directory that carries neither input file (e.g. an iOS-only module)', () => {
    const exists = () => false;
    expect(resolveModuleInputs(['ios-only'], exists)).toEqual([]);
  });
});

describe('decidePrebuildStatus', () => {
  it('reports missing when android/ does not exist, regardless of the hashes', () => {
    expect(decidePrebuildStatus({ androidExists: false, stampedHash: 'abc', currentHash: 'abc' })).toBe('missing');
  });

  it('reports stale when android/ exists but there is no stamped hash yet', () => {
    expect(decidePrebuildStatus({ androidExists: true, stampedHash: null, currentHash: 'abc' })).toBe('stale');
  });

  it('reports stale when android/ exists but the stamped hash disagrees with the current one', () => {
    expect(decidePrebuildStatus({ androidExists: true, stampedHash: 'old', currentHash: 'new' })).toBe('stale');
  });

  it('reports current only when android/ exists and the stamped hash matches', () => {
    expect(decidePrebuildStatus({ androidExists: true, stampedHash: 'same', currentHash: 'same' })).toBe('current');
  });
});

describe('resolveGradleWrapper', () => {
  it('runs the .bat wrapper through a shell on win32', () => {
    expect(resolveGradleWrapper('win32')).toEqual({ executable: 'gradlew.bat', useShell: true });
  });

  it('runs the POSIX wrapper directly on darwin and linux', () => {
    expect(resolveGradleWrapper('darwin')).toEqual({ executable: './gradlew', useShell: false });
    expect(resolveGradleWrapper('linux')).toEqual({ executable: './gradlew', useShell: false });
  });
});

describe('describeMissingToolchain', () => {
  it('names both pieces missing when neither Java nor the Android SDK was found', () => {
    const missing = describeMissingToolchain({ hasJava: false, hasAndroidSdk: false });
    expect(missing).toHaveLength(2);
    expect(missing.join(' ')).toContain('Java');
    expect(missing.join(' ')).toContain('Android SDK');
  });

  it('names only Java when the SDK is present', () => {
    expect(describeMissingToolchain({ hasJava: false, hasAndroidSdk: true })).toEqual([
      expect.stringContaining('Java'),
    ]);
  });

  it('names only the Android SDK when Java is present', () => {
    expect(describeMissingToolchain({ hasJava: true, hasAndroidSdk: false })).toEqual([
      expect.stringContaining('Android SDK'),
    ]);
  });

  it('reports nothing missing when both are present, so the caller may proceed', () => {
    expect(describeMissingToolchain({ hasJava: true, hasAndroidSdk: true })).toEqual([]);
  });
});
