import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const JEST_BIN_PATH = join(PROJECT_ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
const TEMP_DIRECTORY_PREFIX = join(PROJECT_ROOT, 'tests', 'focused-guard-');
const FOCUSED_GUARD_MESSAGE =
  'Focused tests are forbidden in this project. Remove .only or focused aliases before running Jest.';

interface FocusedGuardExecutionResult {
  readonly stderr: string;
  readonly status: number | null;
  readonly stdout: string;
}

function runGuardFixture(source: string): FocusedGuardExecutionResult {
  const tempDirectory = mkdtempSync(TEMP_DIRECTORY_PREFIX);
  const testPath = join(tempDirectory, 'focused-guard.fixture.test.ts');
  writeFileSync(testPath, source);

  try {
    const result = spawnSync(
      process.execPath,
      [JEST_BIN_PATH, '--runInBand', '--runTestsByPath', testPath],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
      },
    );

    return {
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } finally {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
}

describe('jest focused test guard', () => {
  it('fails real Jest execution for every focused test alias and preserves normal concurrent tests', () => {
    const focusedFixtures = [
      `test.only('guarded standard test', () => { expect(true).toBe(true); });`,
      `test.concurrent.only('guarded concurrent test', async () => { expect(true).toBe(true); });`,
      `fit('guarded fit test', () => { expect(true).toBe(true); });`,
      `fdescribe('guarded fdescribe suite', () => { it('does not run', () => { expect(true).toBe(true); }); });`,
    ];

    for (const focusedFixture of focusedFixtures) {
      const focusedResult = runGuardFixture(focusedFixture);

      expect(focusedResult.status).not.toBe(0);
      expect(`${focusedResult.stdout}\n${focusedResult.stderr}`).toContain(FOCUSED_GUARD_MESSAGE);
    }

    const concurrentResult = runGuardFixture(`test.concurrent('plain concurrent test', async () => { expect(true).toBe(true); });`);

    expect(concurrentResult.status).toBe(0);
  });
});
