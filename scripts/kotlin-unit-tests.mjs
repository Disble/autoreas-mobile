// Kotlin unit-test gate for the native modules with a JUnit/Robolectric harness.
//
// Runs `:sync-engine:testDebugUnitTest` and `:foreground-sync-ticker:testDebugUnitTest` from a
// host-generated `android/` project, regenerating it first when it is missing or stale (see
// `scripts/lib/kotlin-tests.mjs` for what "stale" means). Invoked by lefthook's `pre-commit` hook
// only when `modules/*/android/**` is staged, and by `.github/workflows/release.yml`'s `guard`
// job before the release build. Exits non-zero on any failure -- a failed prebuild, a missing
// Java/Android SDK toolchain, or a failed Gradle run -- and never silently skips the check.
//
// This file is the thin entry point only: every decision (what counts as a prebuild input, the
// staleness verdict, the platform-correct Gradle wrapper, the missing-toolchain message) lives in
// `scripts/lib/kotlin-tests.mjs`, which is unit-tested. This file owns process spawning, the
// filesystem walk that turns real files into the inputs the decision layer hashes, and the exit
// code.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  PREBUILD_INPUT_DIR,
  STATIC_PREBUILD_INPUTS,
  buildGradleTestArgs,
  decidePrebuildStatus,
  describeMissingToolchain,
  hashPrebuildInputs,
  resolveGradleWrapper,
  resolveModuleInputs,
} from './lib/kotlin-tests.mjs';

/** Repository root, resolved via git so this runs the same from any cwd inside the worktree. */
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

/** The generated Android project this gate tests; never committed (see `.git/info/exclude`). */
const androidDir = path.join(root, 'android');

/** Stamp file recording the input hash of the `android/` project's last successful prebuild. */
const stampFile = path.join(androidDir, '.kotlin-tests-prebuild-stamp');

/** Lists every file under a directory recursively, as repo-relative POSIX paths. */
function listFilesRecursive(absDir, baseForRelative) {
  if (!existsSync(absDir)) return [];
  const out = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(abs, baseForRelative));
    else out.push(path.relative(baseForRelative, abs).replaceAll('\\', '/'));
  }
  return out;
}

/** Every `modules/*` directory name directly under `modules/`. */
function listModuleDirs() {
  const modulesDir = path.join(root, 'modules');
  if (!existsSync(modulesDir)) return [];
  return readdirSync(modulesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

/** Resolves the full set of repo-relative prebuild-input paths that currently exist on disk. */
function resolvePrebuildInputPaths() {
  const pluginFiles = listFilesRecursive(path.join(root, PREBUILD_INPUT_DIR), root);
  const moduleFiles = resolveModuleInputs(listModuleDirs(), (rel) => existsSync(path.join(root, rel)));
  return [...STATIC_PREBUILD_INPUTS.filter((rel) => existsSync(path.join(root, rel))), ...pluginFiles, ...moduleFiles];
}

/** Reads every resolved input path's content and hashes them into the current staleness digest. */
function computeCurrentHash() {
  const entries = resolvePrebuildInputPaths().map((rel) => ({ path: rel, content: readFileSync(path.join(root, rel), 'utf8') }));
  return hashPrebuildInputs(entries);
}

/** Reads the stamped hash from a previous successful prebuild, or null when there is none to read. */
function readStampedHash() {
  try {
    return JSON.parse(readFileSync(stampFile, 'utf8')).hash ?? null;
  } catch {
    return null;
  }
}

/** True when a spawnSync result represents a failed run: a spawn error, or a non-zero exit. */
function isSpawnFailure(result) {
  return Boolean(result.error) || result.status !== 0;
}

/** Renders a spawnSync failure as one short reason: the spawn error, or the exit code. */
function describeSpawnFailure(result) {
  return result.error ? result.error.message : `exit ${result.status}`;
}

/** Runs `expo prebuild` for Android only, streaming its output; throws on a non-zero exit. */
function runPrebuild() {
  console.log('kotlin-unit-tests: android/ is missing or stale -- running `expo prebuild -p android --no-install`...');
  const result = spawnSync('npx', ['expo', 'prebuild', '-p', 'android', '--no-install'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (isSpawnFailure(result)) {
    throw new Error(`expo prebuild failed (${describeSpawnFailure(result)})`);
  }
}

/** Writes the stamp file recording the hash the just-completed prebuild was generated from. */
function writeStamp(hash) {
  mkdirSync(androidDir, { recursive: true });
  writeFileSync(stampFile, JSON.stringify({ hash }, null, 2));
}

/** Ensures `android/` exists and matches the current inputs, regenerating it when it does not. */
function ensureAndroidProjectCurrent() {
  const currentHash = computeCurrentHash();
  const status = decidePrebuildStatus({ androidExists: existsSync(androidDir), stampedHash: readStampedHash(), currentHash });
  if (status === 'current') {
    console.log('kotlin-unit-tests: android/ is current, skipping prebuild.');
    return;
  }
  runPrebuild();
  writeStamp(currentHash);
}

/** True when a usable JDK can be found: `java -version` succeeds (PATH/JAVA_HOME resolve). */
function hasUsableJava() {
  return spawnSync('java', ['-version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
}

/** True when an Android SDK can be found: an env var, or `android/local.properties` naming one. */
function hasUsableAndroidSdk() {
  if (process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT) return true;
  try {
    return readFileSync(path.join(androidDir, 'local.properties'), 'utf8').includes('sdk.dir=');
  } catch {
    return false;
  }
}

/** Prints each missing-toolchain reason, one per line, under a fixed header. */
function reportMissingToolchain(missing) {
  console.error('kotlin-unit-tests: cannot run the Kotlin unit tests -- missing toolchain:');
  for (const reason of missing) console.error(`  - ${reason}`);
}

/** Exits for a completed Gradle spawnSync result: a spawn error is reported and non-zero; otherwise Gradle's own exit code decides (never 0 on a missing status). */
function exitForGradleResult(wrapperPath, result) {
  if (result.error) {
    console.error(`kotlin-unit-tests: failed to run ${wrapperPath}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

/** True when `--with-lint` was passed on the CLI (C3): runs the Android lint tasks for
 *  `sync-engine` and `foreground-sync-ticker` in the same Gradle invocation as the unit tests.
 *  `bun run test:kotlin -- --with-lint` forwards this the same way npm scripts do. */
function withLintRequested() {
  return process.argv.includes('--with-lint');
}

/** Runs the Gradle unit-test (and, with `--with-lint`, lint) command for both modules with the
 *  platform-correct wrapper, streaming output. */
function runGradleTests() {
  const missing = describeMissingToolchain({ hasJava: hasUsableJava(), hasAndroidSdk: hasUsableAndroidSdk() });
  if (missing.length > 0) {
    reportMissingToolchain(missing);
    process.exit(1);
  }
  const { executable, useShell } = resolveGradleWrapper(process.platform);
  // Resolved to an absolute path: cmd.exe's search order for a bare `gradlew.bat` depends on how
  // the shell was invoked, and an absolute path removes the ambiguity on every platform.
  const wrapperPath = path.join(androidDir, executable);
  const args = buildGradleTestArgs({ withLint: withLintRequested() });
  const result = spawnSync(wrapperPath, args, { cwd: androidDir, stdio: 'inherit', shell: useShell });
  exitForGradleResult(wrapperPath, result);
}

try {
  ensureAndroidProjectCurrent();
  runGradleTests();
} catch (error) {
  console.error(`kotlin-unit-tests: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
