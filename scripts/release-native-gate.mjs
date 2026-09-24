// Entry point for the C2 native-gate skip decision (see odd/tasks/build-resource-optimization.md
// and scripts/lib/release-native-gate.mjs for the pure decision logic this wraps). Invoked by the
// `guard` job in `.github/workflows/release.yml`, right before it reports its `native` output.
// That output gates the whole `native` job (Kotlin unit tests + Android lint): `run` means the
// job executes, `skip` means it is skipped outright (visibly, as a skipped job -- not a green,
// empty one) because nothing under the watched paths changed since the previous release tag.
//
// FAIL SAFE BY CONSTRUCTION: this file owns process/git plumbing only. Every git call is wrapped
// in a small helper that throws a reason-tagged `GitPlumbingError` on failure; `main`'s single
// try/catch turns any of those (or anything else unexpected) into `decision=run`. Nothing here can
// make the gate skip on doubt: only `decideNativeGate` returning `run: false` does that, and it
// does so from already-fetched facts, never from a caught error. The one exception to "any git
// failure aborts the whole decision" is `readVersionOnlyDiff`/`collectVersionOnlyDiffs`: a failure
// reading ONE of `app.json`/`package.json`'s own diff fails safe PER FILE (kept as a genuine
// match), not by aborting the entire decision -- see their own comments for why.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { VERSION_BUMP_EXEMPT_PATHS, decideNativeGate, isVersionBumpOnlyDiff, resolvePreviousReleaseTag } from './lib/release-native-gate.mjs';

/** An error tagged with the fail-safe `reason` `main`'s catch block should report it under. */
class GitPlumbingError extends Error {
  constructor(reason, cause) {
    super(`${reason}: ${cause.message}`);
    this.reason = reason;
  }
}

/** Runs `git` with `args` from `cwd`, returning trimmed stdout. Callers wrap their own failures. */
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Splits git's newline-separated output into trimmed, non-empty lines. */
function splitLines(raw) {
  return raw.length > 0 ? raw.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

/** Resolves the repository root, or throws a `git_rev_parse_failed` `GitPlumbingError`. */
function resolveRepoRoot() {
  try {
    return git(['rev-parse', '--show-toplevel'], process.cwd());
  } catch (error) {
    throw new GitPlumbingError('git_rev_parse_failed', error);
  }
}

/** Lists every `v*` tag in the repo, or throws a `git_tag_list_failed` `GitPlumbingError`. */
function listReleaseTags(root) {
  try {
    return splitLines(git(['tag', '--list', 'v*'], root));
  } catch (error) {
    throw new GitPlumbingError('git_tag_list_failed', error);
  }
}

/** Diffs `previousTag` against `currentRef`, or throws a `git_diff_failed` `GitPlumbingError`. */
function diffChangedPaths(root, previousTag, currentRef) {
  try {
    return splitLines(git(['diff', '--name-only', previousTag, currentRef], root));
  } catch (error) {
    throw new GitPlumbingError('git_diff_failed', error);
  }
}

/** Reads and classifies one exempt file's diff (`isVersionBumpOnlyDiff`), or `false` -- fail safe,
 *  kept as a genuine match -- when that one file's diff cannot be read. */
function readVersionOnlyDiff(root, previousTag, currentRef, path) {
  try {
    const diffText = git(['diff', '-U0', previousTag, currentRef, '--', path], root);
    return isVersionBumpOnlyDiff(diffText);
  } catch (error) {
    console.log(`release-native-gate: could not read the diff for ${path} (${error.message}) -- treating it as a genuine change (fail safe).`);
    return false;
  }
}

/**
 * For each version-bump-exempt path (`app.json`, `package.json`) that actually changed, resolves
 * whether its diff was nothing but a version bump. Fails safe PER FILE (see
 * `readVersionOnlyDiff`): unlike every other git call in this file, a failure reading one exempt
 * file's diff must not force the WHOLE gate to run when a completely unrelated watched path
 * already decided that on its own -- it only keeps that one file counted as a genuine match.
 */
function collectVersionOnlyDiffs(root, previousTag, currentRef, changedPaths) {
  const versionOnlyDiffs = {};
  for (const path of VERSION_BUMP_EXEMPT_PATHS) {
    if (changedPaths.includes(path)) {
      versionOnlyDiffs[path] = readVersionOnlyDiff(root, previousTag, currentRef, path);
    }
  }
  return versionOnlyDiffs;
}

/** Writes one `key=value` line to `$GITHUB_OUTPUT`, or logs it when running outside CI (no file). */
function writeOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  } else {
    console.log(`[no GITHUB_OUTPUT set] ${key}=${value}`);
  }
}

/** Renders `run` as the two-word vocabulary the workflow's `if:` conditions read. */
function decisionWord(run) {
  return run ? 'run' : 'skip';
}

/** Logs a second line naming every matched watched path, when `decideNativeGate` found any. */
function logMatchedPaths(matchedPaths) {
  if (matchedPaths.length > 0) {
    console.log(`release-native-gate: matched watched paths: ${matchedPaths.join(', ')}`);
  }
}

/** Logs the full verdict in one line, then writes the `decision` output for the workflow to read. */
function reportDecision({ run, reason, previousTag, currentTag, matchedPaths }) {
  const previousDescription = previousTag ?? '(none)';
  console.log(`release-native-gate: tag=${currentTag ?? '(unknown)'} previous=${previousDescription} reason=${reason} decision=${decisionWord(run)}`);
  logMatchedPaths(matchedPaths);
  writeOutput('decision', decisionWord(run));
}

/** The fail-safe verdict shared by every branch that has nothing safe left to decide from. */
function failSafeVerdict(reason, currentTag) {
  return { run: true, reason, previousTag: null, currentTag: currentTag ?? null, matchedPaths: [] };
}

/**
 * Resolves the decision object for an already-known `currentTag`: the previous-tag resolution
 * check first (a non-`'resolved'` reason returns its own fail-safe verdict without ever diffing),
 * then the diff and the composed decision. Assumes nothing about failure -- every git call it
 * makes throws a reason-tagged `GitPlumbingError` on its own, so `main`'s single catch below is
 * enough to report any of them precisely.
 */
function resolveDecision(currentTag) {
  const root = resolveRepoRoot();
  const tags = listReleaseTags(root);
  const resolution = resolvePreviousReleaseTag(tags, currentTag);
  if (resolution.reason !== 'resolved') {
    return failSafeVerdict(resolution.reason, currentTag);
  }

  const currentRef = process.env.GITHUB_SHA || 'HEAD';
  const changedPaths = diffChangedPaths(root, resolution.previousTag, currentRef);
  const versionOnlyDiffs = collectVersionOnlyDiffs(root, resolution.previousTag, currentRef, changedPaths);
  return { ...decideNativeGate({ tags, currentTag, changedPaths, versionOnlyDiffs }), currentTag };
}

/** Maps a caught error to the fail-safe reason it should be reported under. */
function reasonForError(error) {
  return error instanceof GitPlumbingError ? error.reason : 'unexpected_error';
}

/**
 * Resolves the decision for the current process environment (`GITHUB_REF_NAME`, `GITHUB_SHA`) and
 * reports it. `GITHUB_REF_NAME` missing is checked first, on its own, because `resolveDecision`
 * needs a tag to reason about; every other failure -- a git problem, an unresolved previous tag,
 * or anything unexpected -- is caught here and reported as `run: true` (see `reasonForError`).
 */
function main() {
  const currentTag = process.env.GITHUB_REF_NAME;
  if (!currentTag) {
    reportDecision(failSafeVerdict('github_ref_name_missing', null));
    return;
  }

  try {
    reportDecision(resolveDecision(currentTag));
  } catch (error) {
    console.log(`release-native-gate: ${error.message} -- running the native gate (fail safe).`);
    reportDecision(failSafeVerdict(reasonForError(error), currentTag));
  }
}

main();
