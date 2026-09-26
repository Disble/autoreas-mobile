// Decision logic behind the C2 "skip the native gate when nothing native changed" optimisation
// in `.github/workflows/release.yml` (see odd/tasks/build-resource-optimization.md, C2). This
// module owns everything that can be decided from already-collected facts: the watched-path glob
// list, matching a changed file against it, resolving "the previous release tag" by semantic
// version (never git ancestry -- a hotfix tagged out of chronological order must not pick the
// wrong tag), and combining both into one run/skip verdict. It touches no filesystem, spawns
// nothing and calls no git command itself, so every branch is a plain function of its inputs --
// the entry point (`scripts/release-native-gate.mjs`) owns the real git plumbing and fails safe
// (always `run: true`) around every call into this module.
//
// FAIL SAFE BY CONSTRUCTION: `decideNativeGate` returns `run: false` in exactly one case -- the
// previous release tag resolved cleanly AND no changed path matched a watched glob. Every other
// outcome (unparseable current tag, current tag not found among the given tags, no earlier tag to
// compare against, two tags tying for "closest earlier", or any watched path changed) returns
// `run: true`.

/**
 * Repo-relative glob patterns naming everything that can change the native Android build or its
 * tests. Kept here, not in the workflow, so the same list backs both the CI decision and its
 * tests. `**` matches zero or more full path segments; a lone `*` matches within one segment.
 */
export const NATIVE_GATE_WATCHED_GLOBS = [
  'modules/**/android/**',
  'modules/*/expo-module.config.json',
  // Shared JS<->Kotlin wire-contract fixtures: `ReconcileWireContractTest.kt` reads them as test
  // resources, so a fixture-only change must still run the Kotlin tests.
  'tests/fixtures/sync-contract/**',
  'plugins/**',
  'app.json',
  'eas.json',
  'package.json',
  'bun.lock',
  'scripts/kotlin-unit-tests.mjs',
  'scripts/lib/kotlin-tests.mjs',
  '.github/workflows/release.yml',
];

/**
 * Regex metacharacters that need escaping when a literal glob segment is turned into a regex.
 * Deliberately NOT a global (`/g`) regex: `.test()` on a global regex advances `lastIndex`
 * across calls, which would silently misclassify every other metacharacter when this is reused
 * per-character in a loop, as it is below.
 */
const REGEX_METACHARACTERS = /[.+^${}()|[\]\\]/;

/**
 * Converts one glob pattern into an anchored `RegExp`, supporting exactly the shapes
 * `NATIVE_GATE_WATCHED_GLOBS` needs: a literal path, `*` (matches within one path segment, never
 * across `/`), and `**` (matches zero or more full path segments, including zero -- so
 * `a/**\/b` matches both `a/b` and `a/x/y/b`). Pure string-to-regex conversion; never touches
 * the filesystem.
 */
export function globToRegExp(glob) {
  let pattern = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      i += 2;
      if (glob[i] === '/') {
        pattern += '(?:.*/)?';
        i += 1;
      } else {
        pattern += '.*';
      }
    } else if (char === '*') {
      pattern += '[^/]*';
      i += 1;
    } else if (REGEX_METACHARACTERS.test(char)) {
      pattern += `\\${char}`;
      i += 1;
    } else {
      pattern += char;
      i += 1;
    }
  }
  return new RegExp(`^${pattern}$`);
}

/** True when `filePath` matches at least one glob in `globs` (default: the native-gate list). */
export function isWatchedPath(filePath, globs = NATIVE_GATE_WATCHED_GLOBS) {
  return globs.some((glob) => globToRegExp(glob).test(filePath));
}

/** Matches exactly the tag shape this repo's release workflow ever pushes: `v<major>.<minor>.<patch>`. */
const RELEASE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

/** Parses a release tag into its numeric version parts, or `null` when the tag does not match. */
export function parseReleaseTag(tag) {
  const match = RELEASE_TAG_PATTERN.exec(tag);
  if (!match) return null;
  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

/** Numeric ordering of two parsed release versions: negative, zero, or positive, like `Array#sort`. */
export function compareReleaseVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Resolves the release tag that immediately precedes `currentTag` among `tags`, by semantic
 * version order rather than git ancestry or creation date. Always returns a `reason`; only
 * `'resolved'` carries a usable `previousTag` -- every other reason is a fail-safe signal the
 * caller must treat as "run the gate": `'current_tag_unparseable'`, `'current_tag_not_found'`,
 * `'no_previous_tag'` (current is the earliest release tag), and `'ambiguous_previous_tag'` (two
 * tags tie for the closest earlier version, which should never happen given this repo's own
 * guard against duplicate versions, but is not trusted blindly here).
 */
export function resolvePreviousReleaseTag(tags, currentTag) {
  const currentVersion = parseReleaseTag(currentTag);
  if (!currentVersion) return { previousTag: null, reason: 'current_tag_unparseable' };

  const parsed = tags
    .map((tag) => ({ tag, version: parseReleaseTag(tag) }))
    .filter((entry) => entry.version !== null);

  if (!parsed.some((entry) => entry.tag === currentTag)) {
    return { previousTag: null, reason: 'current_tag_not_found' };
  }

  const earlier = parsed.filter((entry) => compareReleaseVersions(entry.version, currentVersion) < 0);
  if (earlier.length === 0) return { previousTag: null, reason: 'no_previous_tag' };

  earlier.sort((a, b) => compareReleaseVersions(b.version, a.version));
  const [closest, ...rest] = earlier;
  if (rest.length > 0 && compareReleaseVersions(rest[0].version, closest.version) === 0) {
    return { previousTag: null, reason: 'ambiguous_previous_tag' };
  }
  return { previousTag: closest.tag, reason: 'resolved' };
}

/**
 * The only two watched paths whose diff content the gate ever inspects, instead of treating any
 * change to the whole file as native-relevant. Both carry this project's hard-ruled version bump
 * on EVERY release (`.claude/skills/mobile-release/SKILL.md` "Hard Rules"): without this
 * exemption, C2 could never resolve to `run: false` in practice, because these two files always
 * show up as "changed" between any two release tags. Deliberately not a general mechanism for
 * every watched glob -- only these two files ever get their content inspected line-by-line.
 */
export const VERSION_BUMP_EXEMPT_PATHS = ['app.json', 'package.json'];

/** Matches one JSON "version" key/value line, with the diff's leading `+`/`-` already stripped.
 *  `\s*` on both ends tolerates app.json's 4-space and package.json's 2-space indentation. */
const VERSION_LINE_PATTERN = /^\s*"version"\s*:\s*"[^"]*"\s*,?\s*$/;

/** True when a `git diff -U0` line is real changed content (a `+`/`-` line), not a `---`/`+++`
 *  file-header line or any other diff metadata (`diff --git`, `index`, `@@` hunk headers). */
function isDiffContentLine(line) {
  if (line.startsWith('+++') || line.startsWith('---')) return false;
  return line.startsWith('+') || line.startsWith('-');
}

/**
 * Classifies one file's `git diff -U0 <previousTag> <currentRef> -- <path>` output: `true` only
 * when EVERY changed line in it is a `"version": "…"` line (added or removed side alike) --
 * anything else in the file (a plugin entry, an Android config block, a permission, a dependency,
 * a script) makes this `false`. Fails safe to `false` when there is no recognizable changed-content
 * line at all, since that means this function could not confirm the diff was version-only.
 */
export function isVersionBumpOnlyDiff(diffText) {
  const contentLines = diffText.split('\n').filter(isDiffContentLine);
  if (contentLines.length === 0) return false;
  return contentLines.every((line) => VERSION_LINE_PATTERN.test(line.slice(1)));
}

/**
 * Drops every path in `matchedPaths` that is BOTH one of `VERSION_BUMP_EXEMPT_PATHS` AND recorded
 * `true` in `versionOnlyDiffs` -- i.e. a version-bump-exempt file whose entire diff was confirmed
 * to be nothing but its version line. Every other matched path passes through unchanged. Fails
 * safe: an exempt path with no entry in `versionOnlyDiffs` (its diff could not be read or parsed)
 * is kept, exactly like a `false` entry -- only an explicit `true` can drop it.
 */
export function excludeVersionOnlyBumps(matchedPaths, versionOnlyDiffs) {
  return matchedPaths.filter((path) => {
    if (!VERSION_BUMP_EXEMPT_PATHS.includes(path)) return true;
    return versionOnlyDiffs[path] !== true;
  });
}

/**
 * Decides whether the native gate (Kotlin unit tests + Android lint) must run for `currentTag`.
 * Composes `resolvePreviousReleaseTag`, `isWatchedPath` and `excludeVersionOnlyBumps`: any
 * non-`'resolved'` previous-tag reason is passed straight through as `run: true` without looking
 * at `changedPaths` at all. Otherwise, watched-glob matches are filtered through
 * `excludeVersionOnlyBumps` before deciding: only a resolved previous tag with zero matched paths
 * LEFT AFTER that exemption returns `run: false`. `versionOnlyDiffs` defaults to `{}` (nothing
 * exempted), which fails safe exactly like every entry being absent.
 */
export function decideNativeGate({ tags, currentTag, changedPaths, globs = NATIVE_GATE_WATCHED_GLOBS, versionOnlyDiffs = {} }) {
  const resolution = resolvePreviousReleaseTag(tags, currentTag);
  if (resolution.reason !== 'resolved') {
    return { run: true, reason: resolution.reason, previousTag: null, matchedPaths: [] };
  }

  const allMatchedPaths = changedPaths.filter((filePath) => isWatchedPath(filePath, globs));
  const matchedPaths = excludeVersionOnlyBumps(allMatchedPaths, versionOnlyDiffs);
  if (matchedPaths.length > 0) {
    return { run: true, reason: 'native_paths_changed', previousTag: resolution.previousTag, matchedPaths };
  }
  return { run: false, reason: 'no_native_paths_changed', previousTag: resolution.previousTag, matchedPaths: [] };
}
