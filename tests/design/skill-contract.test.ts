/**
 * Executable contract for the design-system skill (`mobile-design-system`) and the `docs/design/`
 * pages it points at.
 *
 * Every project skill ships twice, under `.agents/skills/` and `.claude/skills/`, because both
 * runtimes read it, so the mirrors are compared as bytes: a whitespace-only edit to one copy is * Exactly the drift this guard catches. The skill links the design pages instead of restating
 * them, so a renamed page leaves a skill that reads fine and points nowhere; every
 * `docs/design/...` path it names is resolved on disk.
 *
 * Proves both directions, each on a real run: a diverged mirror fails, a missing page fails. It
 * proves nothing about whether the skill's rules are true, whether a page is accurate, or how
 * anything renders. The negative cases feed synthetic input to the same helpers.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Absolute path of the repository root, resolved from this test file. */
const REPO_ROOT = path.resolve(__dirname, '../..');

/** The two mirrors of the design-system skill, which must stay byte-identical. */
const SKILL_MIRRORS = [
  '.agents/skills/mobile-design-system/SKILL.md',
  '.claude/skills/mobile-design-system/SKILL.md',
] as const;

/** The copy every other mirror is compared against. */
const REFERENCE_MIRROR = SKILL_MIRRORS[0];

/** One repository-relative `docs/design/` page reference; a trailing `#anchor` is not matched. */
const DOC_PATH_PATTERN = /docs\/design\/[\w./-]+\.md/g;

/** True when a repository-relative path exists and is a regular file rather than a directory. */
function isRepositoryFile(relativePath: string): boolean {
  const absolutePath = path.resolve(REPO_ROOT, relativePath);
  return existsSync(absolutePath) && statSync(absolutePath).isFile();
}

/** Bytes of one repository-relative file, failing with its path instead of a bare `ENOENT`. */
function readRepositoryFile(relativePath: string): Buffer {
  if (!isRepositoryFile(relativePath)) {
    throw new Error(`the skill contract reads a file that does not exist: ${relativePath}`);
  }
  return readFileSync(path.resolve(REPO_ROOT, relativePath));
}

/** Distinct `docs/design/` pages a markdown source references, in the order it names them. */
function listReferencedDocPaths(source: string): readonly string[] {
  return [...new Set(source.match(DOC_PATH_PATTERN) ?? [])];
}

/**
 * Compares every mirror against the first one, in `SKILL_MIRRORS` order, and returns one actionable
 * line per copy that diverges instead of a bare `false`.
 */
function findMirrorViolations(copies: readonly Buffer[]): readonly string[] {
  const [referenceBytes, ...otherCopies] = copies;
  if (referenceBytes === undefined) return [`no copy of ${REFERENCE_MIRROR} was read`];
  return otherCopies.flatMap((bytes, index) =>
    bytes.equals(referenceBytes)
      ? []
      : [`${SKILL_MIRRORS[index + 1]} (${bytes.length} bytes) differs from ${REFERENCE_MIRROR} ` +
          `(${referenceBytes.length} bytes); copy the reference file byte for byte`],
  );
}

/** One actionable line per referenced page that is absent, or is not a regular file. */
function findUnreadableDocPaths(
  docPaths: readonly string[],
  isFile: (relativePath: string) => boolean = isRepositoryFile,
): readonly string[] {
  return docPaths
    .filter((docPath) => !isFile(docPath))
    .map((docPath) => `${docPath} is referenced by the design-system skill but is not a file; ` +
      'add the page or drop the reference');
}

/** The skill source both sets of assertions read, so a missing mirror is named in the failure. */
const SKILL_SOURCE = readRepositoryFile(REFERENCE_MIRROR).toString('utf8');

/** Every `docs/design/` page the skill names. */
const REFERENCED_DOC_PATHS = listReferencedDocPaths(SKILL_SOURCE);

describe('the design-system skill mirrors', () => {
  it('ships both copies byte-identically', () => {
    const copies = SKILL_MIRRORS.map((reference) => readRepositoryFile(reference));

    expect(findMirrorViolations(copies).join('\n')).toBe('');
  });

  it('reports a diverged copy instead of silently passing on one file', () => {
    const referenceBytes = readRepositoryFile(REFERENCE_MIRROR);
    const driftedBytes = Buffer.concat([referenceBytes, Buffer.from('\n')]);
    const violations = findMirrorViolations([referenceBytes, driftedBytes]);

    expect(violations).toHaveLength(SKILL_MIRRORS.length - 1);
    expect(violations[0]).toContain(
      `${SKILL_MIRRORS[1]} (${driftedBytes.length} bytes) differs from ${REFERENCE_MIRROR}`,
    );
  });
});

describe('the docs/design pages the skill links', () => {
  it('names at least one page and resolves every one to a real file', () => {
    expect(REFERENCED_DOC_PATHS.length).toBeGreaterThan(0);
    expect(findUnreadableDocPaths(REFERENCED_DOC_PATHS).join('\n')).toBe('');
  });

  it('reports a page that does not exist instead of ignoring it', () => {
    const missingDocPath = 'docs/design/patterns/does-not-exist.md';
    const violations = findUnreadableDocPaths([...REFERENCED_DOC_PATHS, missingDocPath]);

    expect(violations).toEqual([
      `${missingDocPath} is referenced by the design-system skill but is not a file; ` +
        'add the page or drop the reference',
    ]);
  });
});
