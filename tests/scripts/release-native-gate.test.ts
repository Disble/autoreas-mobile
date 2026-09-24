/**
 * Focused fixture tests for the pure decision logic behind the C2 native-gate skip
 * (`scripts/lib/release-native-gate.mjs`, driven by the thin entry point
 * `scripts/release-native-gate.mjs`).
 *
 * These pin: the glob-to-regex conversion for every shape the watched-path list actually uses
 * (`**`, a single `*`, and literal paths), the watched-path list itself, release-tag parsing and
 * ordering, "previous release tag" resolution (including every fail-safe reason), and the
 * composed run/skip verdict. They need no real filesystem, no git and no network -- the entry
 * point owns all of that, and its own git-failure fail-safe branches are exercised separately
 * (see the task report for the real-git verification run against this repo's own tags).
 *
 * The module under test is plain ESM (`.mjs`), which Jest's CJS runtime cannot `require`
 * directly; it is transformed to CommonJS in-memory with babel and evaluated, so the real
 * source -- not a copy -- is what these tests exercise (same recipe as
 * `tests/scripts/kotlin-tests.test.ts`).
 */

import { transformFileSync } from '@babel/core';
import path from 'node:path';

// Type-only re-declaration of the helpers this fixture consumes. Babel erases it, so the CJS
// runtime never requires the `.mjs`; static analysis (fallow) still sees the named imports,
// which keeps the exports counted as consumed by this test.
import type {
  NATIVE_GATE_WATCHED_GLOBS as NativeGateWatchedGlobs,
  VERSION_BUMP_EXEMPT_PATHS as VersionBumpExemptPaths,
  compareReleaseVersions as CompareReleaseVersions,
  decideNativeGate as DecideNativeGate,
  excludeVersionOnlyBumps as ExcludeVersionOnlyBumps,
  globToRegExp as GlobToRegExp,
  isVersionBumpOnlyDiff as IsVersionBumpOnlyDiff,
  isWatchedPath as IsWatchedPath,
  parseReleaseTag as ParseReleaseTag,
  resolvePreviousReleaseTag as ResolvePreviousReleaseTag,
} from '../../scripts/lib/release-native-gate.mjs';

/** The C2 decision surface, typed from the statically imported helper values. */
type ReleaseNativeGate = {
  NATIVE_GATE_WATCHED_GLOBS: typeof NativeGateWatchedGlobs;
  VERSION_BUMP_EXEMPT_PATHS: typeof VersionBumpExemptPaths;
  compareReleaseVersions: typeof CompareReleaseVersions;
  decideNativeGate: typeof DecideNativeGate;
  excludeVersionOnlyBumps: typeof ExcludeVersionOnlyBumps;
  globToRegExp: typeof GlobToRegExp;
  isVersionBumpOnlyDiff: typeof IsVersionBumpOnlyDiff;
  isWatchedPath: typeof IsWatchedPath;
  parseReleaseTag: typeof ParseReleaseTag;
  resolvePreviousReleaseTag: typeof ResolvePreviousReleaseTag;
};

/** Loads `scripts/lib/release-native-gate.mjs` by transforming it to CJS and evaluating it. */
function loadReleaseNativeGateModule(): ReleaseNativeGate {
  const file = path.resolve(__dirname, '../../scripts/lib/release-native-gate.mjs');
  const result = transformFileSync(file, {
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const { code } = result ?? {};
  if (!code) throw new Error(`babel produced no code for ${file}`);
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports as ReleaseNativeGate;
}

/** The real decision surface, loaded from source. */
const {
  NATIVE_GATE_WATCHED_GLOBS,
  VERSION_BUMP_EXEMPT_PATHS,
  compareReleaseVersions,
  decideNativeGate,
  excludeVersionOnlyBumps,
  globToRegExp,
  isVersionBumpOnlyDiff,
  isWatchedPath,
  parseReleaseTag,
  resolvePreviousReleaseTag,
} = loadReleaseNativeGateModule();

/** A real `git diff -U0` fixture: app.json changing by nothing but its version line (the exact
 *  shape confirmed against this repo's own v1.2.1..v1.2.2 history). */
const APP_JSON_VERSION_ONLY_DIFF = `diff --git a/app.json b/app.json
index 6022c6b..4bbe5b3 100644
--- a/app.json
+++ b/app.json
@@ -5 +5 @@
-    "version": "1.2.1",
+    "version": "1.2.2",
`;

/** Same shape, but for package.json's 2-space indent (confirmed against the same real range). */
const PACKAGE_JSON_VERSION_ONLY_DIFF = `diff --git a/package.json b/package.json
index 911b4e8..514e258 100644
--- a/package.json
+++ b/package.json
@@ -3 +3 @@
-  "version": "1.2.1",
+  "version": "1.2.2",
`;

/** A fixture where app.json's version bump is NOT the only change -- a plugin entry was also
 *  added, so this must never be classified as version-only. */
const APP_JSON_VERSION_PLUS_PLUGIN_DIFF = `diff --git a/app.json b/app.json
index abc1234..def5678 100644
--- a/app.json
+++ b/app.json
@@ -5 +5 @@
-    "version": "1.5.0",
+    "version": "1.6.0",
@@ -20,0 +21 @@
+      "plugins/withSomethingNew.js"
`;

describe('globToRegExp', () => {
  it('matches a **-bounded path at any depth, including zero intermediate segments', () => {
    const re = globToRegExp('modules/**/android/**');
    expect(re.test('modules/sync-engine/android/build.gradle')).toBe(true);
    expect(re.test('modules/sync-engine/android/src/test/kotlin/Foo.kt')).toBe(true);
    expect(re.test('modules/android/build.gradle')).toBe(true);
  });

  it('does not match a path missing the required literal segment', () => {
    const re = globToRegExp('modules/**/android/**');
    expect(re.test('modules/sync-engine/ios/Foo.swift')).toBe(false);
    expect(re.test('src/modules/android/x')).toBe(false);
  });

  it('matches a single * within exactly one path segment', () => {
    const re = globToRegExp('modules/*/expo-module.config.json');
    expect(re.test('modules/sync-engine/expo-module.config.json')).toBe(true);
    expect(re.test('modules/foreground-sync-ticker/expo-module.config.json')).toBe(true);
  });

  it('does not let a single * cross a path segment boundary', () => {
    const re = globToRegExp('modules/*/expo-module.config.json');
    expect(re.test('modules/sync-engine/android/expo-module.config.json')).toBe(false);
  });

  it('matches every file under a plugins/** prefix', () => {
    const re = globToRegExp('plugins/**');
    expect(re.test('plugins/withAndroidForegroundSync.js')).toBe(true);
    expect(re.test('plugins/nested/dir/file.js')).toBe(true);
    expect(re.test('pluginsx/file.js')).toBe(false);
  });

  it('matches a literal path exactly, escaping dots so they cannot match any character', () => {
    const re = globToRegExp('app.json');
    expect(re.test('app.json')).toBe(true);
    expect(re.test('appXjson')).toBe(false);
    expect(re.test('app.json.bak')).toBe(false);
  });

  it('escapes two ADJACENT metacharacters correctly (regression: a global metachar regex leaves lastIndex advanced, so the character right after any matched metachar is silently treated as ordinary)', () => {
    const re = globToRegExp('a..b');
    expect(re.test('a..b')).toBe(true);
    // If the second '.' were left unescaped, it would match any single character here too.
    expect(re.test('aXXb')).toBe(false);
    expect(re.test('a.Xb')).toBe(false);
  });
});

describe('isWatchedPath', () => {
  it('matches every entry the watched-glob list is documented to cover', () => {
    const watched = [
      'modules/sync-engine/android/build.gradle',
      'modules/foreground-sync-ticker/expo-module.config.json',
      'plugins/withAndroidForegroundSync.js',
      'app.json',
      'eas.json',
      'package.json',
      'bun.lock',
      'scripts/kotlin-unit-tests.mjs',
      'scripts/lib/kotlin-tests.mjs',
      '.github/workflows/release.yml',
    ];
    for (const filePath of watched) {
      expect(isWatchedPath(filePath)).toBe(true);
    }
  });

  it('does not match unrelated JS/docs paths', () => {
    for (const filePath of ['src/features/animes/index.ts', 'docs/deployment.md', 'README.md', 'tests/scripts/kotlin-tests.test.ts']) {
      expect(isWatchedPath(filePath)).toBe(false);
    }
  });

  it('uses the exported default glob list when none is passed', () => {
    expect(NATIVE_GATE_WATCHED_GLOBS.length).toBeGreaterThan(0);
    expect(isWatchedPath('app.json', NATIVE_GATE_WATCHED_GLOBS)).toBe(true);
  });
});

describe('parseReleaseTag', () => {
  it('parses a well-formed release tag', () => {
    expect(parseReleaseTag('v1.6.0')).toEqual({ major: 1, minor: 6, patch: 0 });
  });

  it('rejects a tag missing the v prefix, a non-semver tag, and a suffixed tag', () => {
    expect(parseReleaseTag('1.6.0')).toBeNull();
    expect(parseReleaseTag('vlatest')).toBeNull();
    expect(parseReleaseTag('v1.6.0-rc.1')).toBeNull();
  });
});

describe('compareReleaseVersions', () => {
  it('orders by major, then minor, then patch', () => {
    const v = (major: number, minor: number, patch: number) => ({ major, minor, patch });
    expect(compareReleaseVersions(v(1, 0, 0), v(2, 0, 0))).toBeLessThan(0);
    expect(compareReleaseVersions(v(1, 5, 0), v(1, 4, 9))).toBeGreaterThan(0);
    expect(compareReleaseVersions(v(1, 2, 3), v(1, 2, 3))).toBe(0);
  });
});

describe('resolvePreviousReleaseTag', () => {
  const tags = ['v1.0.0', 'v1.0.1', 'v1.1.0', 'v1.2.0', 'v1.5.0', 'v1.6.0'];

  it('resolves the immediately preceding version by semver, not list order', () => {
    expect(resolvePreviousReleaseTag(tags, 'v1.6.0')).toEqual({ previousTag: 'v1.5.0', reason: 'resolved' });
    expect(resolvePreviousReleaseTag([...tags].reverse(), 'v1.6.0')).toEqual({ previousTag: 'v1.5.0', reason: 'resolved' });
  });

  it('fails safe with no_previous_tag when the current tag is the earliest release', () => {
    expect(resolvePreviousReleaseTag(tags, 'v1.0.0')).toEqual({ previousTag: null, reason: 'no_previous_tag' });
  });

  it('fails safe with current_tag_not_found when the current tag is absent from the list', () => {
    expect(resolvePreviousReleaseTag(tags, 'v9.9.9')).toEqual({ previousTag: null, reason: 'current_tag_not_found' });
  });

  it('fails safe with current_tag_unparseable when the current tag is not v<semver>', () => {
    expect(resolvePreviousReleaseTag(tags, 'not-a-tag')).toEqual({ previousTag: null, reason: 'current_tag_unparseable' });
  });

  it('fails safe with ambiguous_previous_tag when two tags tie for the closest earlier version', () => {
    const duplicated = ['v1.0.0', 'v1.5.0', 'v1.5.0', 'v1.6.0'];
    expect(resolvePreviousReleaseTag(duplicated, 'v1.6.0')).toEqual({ previousTag: null, reason: 'ambiguous_previous_tag' });
  });

  it('ignores tags that do not match the release-tag shape', () => {
    const withJunk = [...tags, 'nightly', 'v1.6.0-rc.1'];
    expect(resolvePreviousReleaseTag(withJunk, 'v1.6.0')).toEqual({ previousTag: 'v1.5.0', reason: 'resolved' });
  });
});

describe('isVersionBumpOnlyDiff', () => {
  it('is true for a real diff that changes nothing but app.json\'s version line', () => {
    expect(isVersionBumpOnlyDiff(APP_JSON_VERSION_ONLY_DIFF)).toBe(true);
  });

  it('is true for the same shape at package.json\'s 2-space indent', () => {
    expect(isVersionBumpOnlyDiff(PACKAGE_JSON_VERSION_ONLY_DIFF)).toBe(true);
  });

  it('is false when a version bump shares the diff with any other changed line', () => {
    expect(isVersionBumpOnlyDiff(APP_JSON_VERSION_PLUS_PLUGIN_DIFF)).toBe(false);
  });

  it('fails safe (false) when there is no recognizable +/- content line at all', () => {
    expect(isVersionBumpOnlyDiff('')).toBe(false);
    expect(isVersionBumpOnlyDiff('diff --git a/app.json b/app.json\nindex abc..def 100644\n')).toBe(false);
  });

  it('ignores diff metadata lines (---/+++ file headers), never mistaking them for content', () => {
    // A file literally named such that "--- a/app.json" or "+++ b/app.json" could be confused
    // for a removed/added content line if the metadata lines were not excluded first.
    expect(isVersionBumpOnlyDiff(APP_JSON_VERSION_ONLY_DIFF)).toBe(true);
  });
});

describe('excludeVersionOnlyBumps', () => {
  it('drops an exempt path whose diff was classified version-only', () => {
    expect(excludeVersionOnlyBumps(['app.json', 'package.json'], { 'app.json': true, 'package.json': true })).toEqual([]);
  });

  it('keeps an exempt path whose diff was classified as more than a version bump', () => {
    expect(excludeVersionOnlyBumps(['app.json'], { 'app.json': false })).toEqual(['app.json']);
  });

  it('fails safe: keeps an exempt path missing from versionOnlyDiffs (its diff could not be read)', () => {
    expect(excludeVersionOnlyBumps(['app.json'], {})).toEqual(['app.json']);
  });

  it('never drops a non-exempt path, regardless of versionOnlyDiffs', () => {
    const matched = ['modules/sync-engine/android/build.gradle', 'app.json'];
    expect(excludeVersionOnlyBumps(matched, { 'app.json': true, 'modules/sync-engine/android/build.gradle': true })).toEqual([
      'modules/sync-engine/android/build.gradle',
    ]);
  });

  it('exempts exactly app.json and package.json, nothing else', () => {
    expect(VERSION_BUMP_EXEMPT_PATHS).toEqual(['app.json', 'package.json']);
  });
});

describe('decideNativeGate', () => {
  const tags = ['v1.5.0', 'v1.6.0'];

  it('runs when a changed path matches a watched glob', () => {
    const changedPaths = ['modules/sync-engine/android/build.gradle', 'src/features/animes/index.ts'];
    expect(decideNativeGate({ tags, currentTag: 'v1.6.0', changedPaths })).toEqual({
      run: true,
      reason: 'native_paths_changed',
      previousTag: 'v1.5.0',
      matchedPaths: ['modules/sync-engine/android/build.gradle'],
    });
  });

  it('skips when every changed path is unrelated to the native build (the JS-only fixture)', () => {
    const changedPaths = ['src/features/animes/index.ts', 'docs/deployment.md', 'CHANGELOG.md'];
    expect(decideNativeGate({ tags, currentTag: 'v1.6.0', changedPaths })).toEqual({
      run: false,
      reason: 'no_native_paths_changed',
      previousTag: 'v1.5.0',
      matchedPaths: [],
    });
  });

  it('runs, without even inspecting changedPaths, when there is no previous tag to compare against', () => {
    expect(decideNativeGate({ tags: ['v1.0.0'], currentTag: 'v1.0.0', changedPaths: ['docs/deployment.md'] })).toEqual({
      run: true,
      reason: 'no_previous_tag',
      previousTag: null,
      matchedPaths: [],
    });
  });

  it('skips a release that changed only app.json and package.json, both by nothing but the version bump', () => {
    const changedPaths = ['app.json', 'package.json'];
    const versionOnlyDiffs = { 'app.json': true, 'package.json': true };
    expect(decideNativeGate({ tags, currentTag: 'v1.6.0', changedPaths, versionOnlyDiffs })).toEqual({
      run: false,
      reason: 'no_native_paths_changed',
      previousTag: 'v1.5.0',
      matchedPaths: [],
    });
  });

  it('still runs when app.json\'s bump is version-only but package.json\'s is not', () => {
    const changedPaths = ['app.json', 'package.json'];
    const versionOnlyDiffs = { 'app.json': true, 'package.json': false };
    expect(decideNativeGate({ tags, currentTag: 'v1.6.0', changedPaths, versionOnlyDiffs })).toEqual({
      run: true,
      reason: 'native_paths_changed',
      previousTag: 'v1.5.0',
      matchedPaths: ['package.json'],
    });
  });

  it('still runs when app.json is version-only but another watched path also changed (e.g. plugins/)', () => {
    const changedPaths = ['app.json', 'package.json', 'plugins/withSomethingNew.js'];
    const versionOnlyDiffs = { 'app.json': true, 'package.json': true };
    expect(decideNativeGate({ tags, currentTag: 'v1.6.0', changedPaths, versionOnlyDiffs })).toEqual({
      run: true,
      reason: 'native_paths_changed',
      previousTag: 'v1.5.0',
      matchedPaths: ['plugins/withSomethingNew.js'],
    });
  });

  it('fails safe: runs when versionOnlyDiffs is omitted entirely, even though app.json/package.json changed', () => {
    const changedPaths = ['app.json', 'package.json'];
    expect(decideNativeGate({ tags, currentTag: 'v1.6.0', changedPaths })).toEqual({
      run: true,
      reason: 'native_paths_changed',
      previousTag: 'v1.5.0',
      matchedPaths: ['app.json', 'package.json'],
    });
  });
});
