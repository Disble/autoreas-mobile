// Decision logic behind the Kotlin-unit-test gate (`scripts/kotlin-unit-tests.mjs`).
//
// This module owns everything that can be decided from already-collected facts: which files
// decide whether `android/` is stale, hashing them deterministically, deciding whether a
// prebuild is needed, picking the platform-correct Gradle wrapper invocation, and naming a
// missing Java/Android-SDK toolchain. It touches no filesystem and spawns nothing itself, so
// every branch is a plain function of its inputs -- the entry point supplies the real
// `existsSync`/`readFileSync`/env facts and owns the actual prebuild and Gradle spawns.

import { createHash } from 'node:crypto';

/** Repo-relative files whose content always participates in the `android/` staleness hash. */
export const STATIC_PREBUILD_INPUTS = ['app.json', 'package.json', 'bun.lock'];

/** Directory recursively scanned for extra prebuild inputs: any config plugin can change the generated project. */
export const PREBUILD_INPUT_DIR = 'plugins';

/** Per-module basenames that feed the generated `android/` project when the module directory carries them.
 *  Not exported: only `resolveModuleInputs` below needs it. */
const MODULE_INPUT_BASENAMES = ['expo-module.config.json', 'android/build.gradle'];

/** Gradle module targets the Kotlin unit-test gate exercises, in `./gradlew` task-path form.
 *  Not exported: only `buildGradleTestArgs` below needs it. */
const GRADLE_TEST_TASKS = [':sync-engine:testDebugUnitTest', ':foreground-sync-ticker:testDebugUnitTest'];

/** Per-class coverage verification tasks (T3, sync-core-test-assurance): the CORE (100%) and
 *  IMPORTANT (80%) Kover rules configured in each module's `build.gradle`. `sync-engine` splits
 *  its two tiers into the custom `core`/`important` report variants (see that module's
 *  `build.gradle`); `foreground-sync-ticker` carries only an IMPORTANT tier, verified on its
 *  existing `debug` variant. Each verify task already depends on its module's
 *  `testDebugUnitTest`, so this list runs no test twice -- it only adds the coverage check after
 *  tests already listed in [GRADLE_TEST_TASKS] run.
 *  Not exported: only `buildGradleTestArgs` below needs it. */
const GRADLE_COVERAGE_VERIFY_TASKS = [
  ':sync-engine:koverVerifyCore',
  ':sync-engine:koverVerifyImportant',
  ':sync-engine:koverVerifyCoreFloor',
  ':sync-engine:koverVerifyCoreFloorRunner',
  ':foreground-sync-ticker:koverVerifyDebug',
];

/** Android lint task targets for the same two modules (C3), in `./gradlew` task-path form.
 *  Not exported: only `buildGradleTestArgs` below needs it. `lintDebug`, not `lintVital`: the
 *  release build already runs `lintVitalAnalyzeRelease` for every module, so this only needs the
 *  full debug lint ruleset lintVital's fatal-only subset does not cover (see
 *  .github/workflows/release.yml's own comment on the equivalent step for the full reasoning). */
const GRADLE_LINT_TASKS = [':sync-engine:lintDebug', ':foreground-sync-ticker:lintDebug'];

/**
 * Builds the full Gradle argv (task paths plus flags) for the unit-test invocation. Passing
 * `withLint: true` (C3) appends the Android lint tasks for the same two modules so both run in
 * ONE Gradle invocation -- one configuration phase, one daemon -- instead of the test run and a
 * separate `./gradlew :sync-engine:lintDebug :foreground-sync-ticker:lintDebug` afterwards.
 *
 * `--build-cache` (C1) turns on Gradle's build cache for this invocation only (equivalent to
 * `org.gradle.caching=true`, scoped to just this command line, never written to a shared
 * `gradle.properties`): CI backs it with `gradle/actions/setup-gradle`'s GitHub Actions cache,
 * and a local run without that action still gets the default `~/.gradle` build-cache directory.
 * Always on, whether this runs from `.github/workflows/release.yml`'s `native` job or lefthook's
 * local `native` pre-commit job (lefthook.yml) -- both run the same debug-variant tests/lint that
 * ship in no release artifact, so reusing their cached task outputs carries no release-reproducibility
 * risk, unlike the release build's own Gradle invocation, which never receives this flag.
 */
export function buildGradleTestArgs({ withLint = false } = {}) {
  const tasks = withLint
    ? [...GRADLE_TEST_TASKS, ...GRADLE_COVERAGE_VERIFY_TASKS, ...GRADLE_LINT_TASKS]
    : [...GRADLE_TEST_TASKS, ...GRADLE_COVERAGE_VERIFY_TASKS];
  return [...tasks, '--build-cache', '--console=plain'];
}

/**
 * Resolves the `modules/*` input paths that exist on disk, given the module directory names and an
 * existence predicate (dependency-injected so this stays pure and needs no real filesystem to test).
 */
export function resolveModuleInputs(moduleDirs, exists) {
  const inputs = [];
  for (const dir of moduleDirs.toSorted()) {
    for (const basename of MODULE_INPUT_BASENAMES) {
      const rel = `modules/${dir}/${basename}`;
      if (exists(rel)) inputs.push(rel);
    }
  }
  return inputs;
}

/**
 * Hashes a set of `{path, content}` entries into one deterministic digest: entries are sorted by
 * path first, so the hash never changes just because the filesystem listed them in a different
 * order. Two runs over the same repo-relative paths and content always agree.
 */
export function hashPrebuildInputs(entries) {
  const hash = createHash('sha256');
  for (const { path: entryPath, content } of entries.toSorted((a, b) => a.path.localeCompare(b.path))) {
    hash.update(entryPath);
    hash.update('\u0000');
    hash.update(content);
    hash.update('\u0000');
  }
  return hash.digest('hex');
}

/**
 * Decides what the prebuild step must do: `'missing'` when `android/` is not there at all,
 * `'stale'` when it exists but the stamped hash disagrees with (or is absent from) the current
 * one, `'current'` when the stamp already matches. Missing takes priority over stale so a caller
 * never reports a stale stamp for a directory that does not exist.
 */
export function decidePrebuildStatus({ androidExists, stampedHash, currentHash }) {
  if (!androidExists) return 'missing';
  if (!stampedHash || stampedHash !== currentHash) return 'stale';
  return 'current';
}

/**
 * Resolves the Gradle wrapper invocation for a platform. Windows needs the `.bat` wrapper run
 * through a shell -- Node's `spawn`/`spawnSync` cannot exec `.bat`/`.cmd` files directly -- while
 * every other platform runs the POSIX wrapper script directly, no shell needed.
 */
export function resolveGradleWrapper(platform) {
  return platform === 'win32' ? { executable: 'gradlew.bat', useShell: true } : { executable: './gradlew', useShell: false };
}

/**
 * Names the toolchain pieces that are missing, given already-collected presence facts. Returns an
 * empty array when nothing is missing; a non-empty array is what turns the whole gate non-zero
 * instead of silently skipping the Gradle invocation.
 */
export function describeMissingToolchain({ hasJava, hasAndroidSdk }) {
  const missing = [];
  if (!hasJava) missing.push('Java (JDK): no JAVA_HOME and `java -version` failed');
  if (!hasAndroidSdk) missing.push('Android SDK: no ANDROID_HOME/ANDROID_SDK_ROOT and android/local.properties has no sdk.dir');
  return missing;
}
