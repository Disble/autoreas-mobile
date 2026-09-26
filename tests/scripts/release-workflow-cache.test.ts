/**
 * Focused regression tests for the release workflow's Gradle cache policy and trigger
 * (`.github/workflows/release.yml`).
 *
 * These pin the v1.7.0 decision: `gradle/actions/setup-gradle` in BOTH the `native` and `build`
 * jobs runs `cache-read-only: true`, because a release only ever executes on a pushed tag and
 * GitHub scopes each cache entry to the ref that wrote it -- a release's own entry is therefore
 * unreadable by every later release, and nothing on the default branch writes one either. v1.7.0
 * (run 36261199520) restored 0 entries in both jobs and still uploaded 2.32 GB (native) and
 * 1.98 GB (build) of tag-scoped entries (docs/logbooks/build-performance.md, C5).
 *
 * They are static text assertions over the real workflow file, not a YAML parse: the repo has no
 * YAML dependency and this is a policy guard, not a workflow interpreter. `stripCommentLines` is
 * what keeps prose that *quotes* the rejected setting (`cache-read-only: false`) from reading as
 * live configuration -- only the `with:` mapping decides the cache mode.
 *
 * They also pin the pieces that must survive the policy change: the tag-only trigger, the pinned
 * action SHA with its version comment, the `basic` provider, wrapper validation left at its `true`
 * default, the step order in both jobs (`setup-gradle` stays where it is: `native` installs
 * dependencies before it, precisely so wrapper validation can see the `node_modules` wrappers), and
 * the guard/publish/artifact protections.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The real release workflow, read once for every assertion in this file. */
const WORKFLOW = readFileSync(path.resolve(__dirname, '../../.github/workflows/release.yml'), 'utf8');

/** The commit SHA `gradle/actions/setup-gradle` is pinned to, with the version its comment names. */
const SETUP_GRADLE_STEP = 'gradle/actions/setup-gradle@9c971963bec38e04b3d30dcc455b5382be2fdbfb # v6.3.0';

/** Both jobs that hold a Gradle invocation and therefore a `setup-gradle` step. */
const GRADLE_JOBS = ['native', 'build'] as const;

/**
 * Drops YAML comment lines, so text that quotes an old setting as history (a comment naming
 * `cache-read-only: false`) can never satisfy or break an assertion about live configuration.
 */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

/**
 * Returns the source of one top-level YAML key's block, from its `key:` line up to the next
 * non-comment line at column 0 (or the end of the file).
 */
function readDocumentBlock(key: string, source: string = WORKFLOW): string {
  const lines = source.split('\n');
  const startIndex = lines.findIndex((line) => line === `${key}:`);
  if (startIndex === -1) throw new Error(`release workflow has no top-level \`${key}:\` key`);
  const endIndex = lines.findIndex(
    (line, index) => index > startIndex && /^\S/.test(line) && !line.startsWith('#'),
  );
  return lines.slice(startIndex, endIndex === -1 ? undefined : endIndex).join('\n');
}

/**
 * Returns the source of one `jobs.<name>` block, from its two-space key line up to the next
 * two-space job key (or the end of the file).
 */
function readJobBlock(name: string, source: string = WORKFLOW): string {
  const lines = source.split('\n');
  const startIndex = lines.findIndex((line) => line === `  ${name}:`);
  if (startIndex === -1) throw new Error(`release workflow has no \`${name}\` job`);
  const endIndex = lines.findIndex((line, index) => index > startIndex && /^ {2}\S/.test(line));
  return lines.slice(startIndex, endIndex === -1 ? undefined : endIndex).join('\n');
}

/**
 * Returns each step of a job block as raw text, from its six-space `- ` line to the next step (or
 * the end of the job).
 */
function readSteps(jobBlock: string): string[] {
  const steps: string[] = [];
  let current: string[] | null = null;
  for (const line of jobBlock.split('\n')) {
    if (/^ {6}- /.test(line)) {
      if (current) steps.push(current.join('\n'));
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) steps.push(current.join('\n'));
  return steps;
}

/** Returns the `setup-gradle` step of a job, with comment lines already stripped. */
function readGradleSetupStep(jobName: string): string {
  const steps = readSteps(readJobBlock(jobName)).filter((step) =>
    step.includes('gradle/actions/setup-gradle@'),
  );
  expect(steps).toHaveLength(1);
  return stripCommentLines(steps[0]);
}

/** Asserts every marker is present in `text`, in the given order (no marker may repeat). */
function expectMarkersInOrder(text: string, markers: readonly string[]): void {
  const positions = markers.map((marker) => {
    const index = text.indexOf(marker);
    expect({ marker, found: index >= 0 }).toEqual({ marker, found: true });
    return index;
  });
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

describe('release workflow trigger', () => {
  it("runs on a pushed v-tag and on nothing else -- no branch push can start a release", () => {
    const trigger = readDocumentBlock('on');
    expect(trigger).toMatch(/^on:/m);
    expect(trigger).toMatch(/^\s+push:/m);
    expect(trigger).toMatch(/^\s+tags:\s*$/m);
    expect(trigger).toMatch(/^\s+- 'v\*'\s*$/m);
    expect(trigger).not.toMatch(/^\s+branches:/m);
    expect(trigger).not.toMatch(/pull_request|workflow_dispatch|schedule/);
  });
});

describe('release workflow Gradle cache policy', () => {
  it('keeps exactly the two known setup-gradle steps, one per Gradle job', () => {
    const configured = stripCommentLines(WORKFLOW).match(/gradle\/actions\/setup-gradle@/g) ?? [];
    expect(configured).toHaveLength(GRADLE_JOBS.length);
    for (const jobName of GRADLE_JOBS) {
      expect(readJobBlock(jobName)).toContain(SETUP_GRADLE_STEP);
    }
  });

  it.each(GRADLE_JOBS)('makes the %s job read-only, so it never writes a tag-scoped cache', (jobName) => {
    const step = readGradleSetupStep(jobName);
    expect(step).toMatch(/cache-read-only:\s*true/);
  });

  it('has no setup-gradle step anywhere that writes a cache', () => {
    const configured = stripCommentLines(WORKFLOW);
    expect(configured).not.toMatch(/cache-read-only:\s*false/);
    expect(configured.match(/cache-read-only:\s*true/g) ?? []).toHaveLength(GRADLE_JOBS.length);
  });

  it.each(GRADLE_JOBS)('keeps the open-source basic provider in the %s job', (jobName) => {
    // `enhanced` is the action default and Gradle's PROPRIETARY (closed-source) implementation.
    // It is free for public repositories, so this assertion is about provider identity, not price:
    // `basic` is the MIT-licensed provider built on plain `actions/cache` (gradle/actions
    // DISTRIBUTION.md at the pinned SHA).
    const step = readGradleSetupStep(jobName);
    expect(step).toMatch(/cache-provider:\s*basic/);
    expect(step).not.toMatch(/cache-disabled:\s*true/);
  });

  it.each(GRADLE_JOBS)('leaves Gradle wrapper validation enabled in the %s job', (jobName) => {
    const step = readGradleSetupStep(jobName);
    // `validate-wrappers` defaults to true; only an explicit `false` would turn it off.
    expect(step).not.toMatch(/validate-wrappers:\s*false/);
    expect(stripCommentLines(WORKFLOW)).not.toMatch(/validate-wrappers:\s*false/);
  });

  it('keeps the native job\'s setup-gradle AFTER dependency install, where wrapper validation can see the node_modules wrappers', () => {
    const nativeJob = stripCommentLines(readJobBlock('native'));
    expectMarkersInOrder(nativeJob, [
      'actions/checkout@',
      'oven-sh/setup-bun@',
      'name: Install dependencies',
      'actions/setup-java@',
      'gradle/actions/setup-gradle@',
      'bun run test:kotlin -- --with-lint',
    ]);
  });

  it('keeps the build job\'s setup-gradle before the EAS build it caches downloads for', () => {
    const buildJob = stripCommentLines(readJobBlock('build'));
    expectMarkersInOrder(buildJob, [
      'actions/checkout@',
      'actions/setup-java@',
      'gradle/actions/setup-gradle@',
      'oven-sh/setup-bun@',
      'name: Install dependencies',
      'bunx eas-cli@23.2.0 build',
    ]);
  });
});

describe('release workflow retained protections', () => {
  it('keeps the workflow default at read and the write scope only on publish', () => {
    expect(readDocumentBlock('permissions')).toMatch(/^\s+contents:\s*read\s*$/m);
    const publishJob = readJobBlock('publish');
    expect(publishJob).toMatch(/permissions:\s*\n\s+contents:\s*write/);
    // Comment-stripped: the build job's own comment quotes `contents: write` to say it does NOT
    // hold it, and propping that prose up as live configuration would be a false failure.
    expect(stripCommentLines(readJobBlock('build'))).not.toMatch(/contents:\s*write/);
    expect(stripCommentLines(readJobBlock('native'))).not.toMatch(/contents:\s*write/);
  });

  it('keeps publish gated on build succeeding and native succeeding or being skipped by the guard decision', () => {
    const publishIf = readJobBlock('publish');
    expect(publishIf).toContain("needs.build.result == 'success'");
    expect(publishIf).toContain("needs.native.result == 'success'");
    expect(publishIf).toContain("needs.native.result == 'skipped'");
    expect(publishIf).toContain("needs.guard.outputs.native == 'skip'");
  });

  it('keeps the native job fail-closed and the guard/artifact steps intact', () => {
    expect(readJobBlock('native')).toMatch(/if:\s*needs\.guard\.outputs\.native != 'skip'/);
    expect(readJobBlock('guard')).toContain('actions/upload-artifact@');
    const buildJob = stripCommentLines(readJobBlock('build'));
    expect(buildJob).toContain('actions/upload-artifact@');
    for (const guard of [
      'Artifact is an APK, not an app bundle',
      'APK reports the tagged version',
      'Foreground sync survived the prebuild',
      'APK is not debuggable',
      'Checksum',
    ]) {
      expect(buildJob).toContain(guard);
    }
    expect(readJobBlock('publish')).toContain('actions/download-artifact@');
  });
});
