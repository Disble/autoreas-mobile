import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

/** Stryker invocation, spelled as argv so no shell parses the arguments. */
const command = ['bun', 'x', 'stryker'];

/** Directory the hook ran from; every git call and relative path is resolved against it. */
const cwd = process.cwd();

/** Repository root, used to place the incremental cache outside the working tree. */
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();

/** Path to `.git`, which owns the incremental cache so it never lands in a commit. */
const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8' }).trim();

/** This package's path relative to the repository root, empty when they are the same directory. */
const surface = path.relative(root, cwd).replaceAll('\\', '/');

/** Prefix that turns a package-relative path into the repository-relative one git reports. */
const prefix = surface === '' ? '' : `${surface}/`;

/**
 * Stryker's own configuration, read rather than mirrored.
 *
 * The mutation scope used to be a SECOND hardcoded copy of the path that also lives in
 * `stryker.dlinter.json`, with nothing comparing the two. A rename would have updated one and left
 * the other pointing at a file that no longer exists, and the staged-file filter below would then
 * match nothing on every commit -- passing green forever while mutating not one line. Reading the
 * scope from the config makes that drift impossible rather than merely unlikely.
 */
const strykerConfig = JSON.parse(readFileSync(path.resolve(cwd, 'stryker.dlinter.json'), 'utf8'));

/** Package-relative files Stryker is configured to mutate. The single source of truth for scope. */
const configuredSurfaces = strykerConfig.mutate ?? [];

// An empty scope is a broken config, not an empty change. Exiting 0 here would be the exact
// failure this guard exists to catch: a check that measured nothing and reported success.
if (configuredSurfaces.length === 0) {
  console.error('dlinter mutation guard: stryker.dlinter.json declares no `mutate` entries.');
  console.error('This is a defect in the configuration, not an empty change.');
  process.exit(1);
}

/**
 * Configured surfaces that are not on disk.
 *
 * A missing surface is the empty-scope defect one step later: the staged filter would silently
 * match nothing forever. The distinction this guard enforces is "nothing to mutate" versus "cannot
 * find what I was told to mutate" -- the first is a legitimate pass, the second is a broken gate.
 */
const missingSurfaces = configuredSurfaces.filter((entry) => !existsSync(path.resolve(cwd, entry)));

if (missingSurfaces.length > 0) {
  console.error(`dlinter mutation guard: configured mutation surface(s) do not exist: ${missingSurfaces.join(', ')}`);
  console.error('This is a defect in the configuration, not an empty change.');
  process.exit(1);
}

/** Configured surfaces rewritten to the repository-relative form `git diff --cached` reports. */
const mutationSurfaces = configuredSurfaces.map((entry) => `${prefix}${entry}`);

/** Raw newline-separated list of staged paths, added/copied/modified/renamed only. */
const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd, encoding: 'utf8' });

/** The staged paths that fall inside the configured mutation scope. */
const staged = output.split(/\r?\n/).filter((file) => mutationSurfaces.includes(file));

if (staged.length === 0) {
  // State the scope, not just the outcome. A bare "nothing to do" reads identically to a run that
  // killed every mutant once lefthook collapses it to a green tick, and a green tick that measured
  // the empty set is indistinguishable from a real pass. Naming the surface makes the narrowness
  // visible at the point where someone might otherwise trust the check.
  console.log(`dlinter mutation guard: none of the ${configuredSurfaces.length} configured mutation surface(s) are staged, so nothing was mutated.`);
  console.log(`Scope: ${configuredSurfaces.join(', ')}`);
  process.exit(0);
}

for (const file of staged) {
  if (spawnSync('git', ['diff', '--quiet', '--', file], { cwd }).status !== 0) {
    throw new Error(`dlinter mutation guard: partial staging is unsupported for ${file}; stage or revert its remaining changes.`);
  }
}

/** Zero-context staged diff for the selected surfaces, parsed below into mutable line ranges. */
const diff = execFileSync('git', ['diff', '--cached', '--unified=0', '--diff-filter=ACMR', '--', ...staged], { cwd, encoding: 'utf8' });

/** `file:start-end` ranges Stryker will restrict mutation to, so untouched lines are not re-run. */
const ranges = [];

/** The file the diff parser is currently inside, carried across hunk headers. */
let file = '';

for (const line of diff.split(/\r?\n/)) {
  if (line.startsWith('+++ b/')) file = line.slice(6);
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (match && file.startsWith(prefix)) {
    const count = Number(match[2] ?? '1');
    if (count > 0) ranges.push(`${file.slice(prefix.length)}:${match[1]}-${Number(match[1]) + count - 1}`);
  }
}

if (ranges.length === 0) {
  console.log('dlinter mutation guard: no added mutation-surface TypeScript lines.');
  process.exit(0);
}

/** Directory under `.git` holding the incremental cache, kept out of the working tree. */
const cacheDir = path.resolve(root, gitDir, 'dlinter');

/** Stryker's incremental result cache, discarded below if it cannot be parsed. */
const cacheFile = path.join(cacheDir, 'stryker-staged.json');

try {
  if (existsSync(cacheFile)) JSON.parse(readFileSync(cacheFile, 'utf8'));
} catch {
  rmSync(cacheFile, { force: true });
}
mkdirSync(cacheDir, { recursive: true });
rmSync(path.join(cwd, '.dlinter-mutation-tmp'), { recursive: true, force: true });

/** Outcome of the scoped Stryker run; its status becomes this script's exit code. */
const result = spawnSync(command[0], [...command.slice(1), 'run', 'stryker.dlinter.json', '--incremental', '--incrementalFile', cacheFile, '--mutate', ranges.join(','), '--cleanTempDir', 'always'], { cwd, stdio: 'inherit' });
process.exit(result.status ?? 1);
