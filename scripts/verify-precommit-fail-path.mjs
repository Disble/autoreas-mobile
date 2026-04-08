import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const tempDir = path.join('src', '.sdd-temp');
const tempFile = path.join(tempDir, 'precommit-fail-path.tsx');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function cleanup() {
  try {
    run('git', ['reset', '--', tempFile]);
  } catch {}

  rmSync(tempFile, { force: true });

  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
}

try {
  mkdirSync(tempDir, { recursive: true });

  writeFileSync(
    tempFile,
    [
      "import React from 'react';",
      '',
      'export default function BrokenPreCommitFixture() {',
      '  const broken = ;',
      '  return <>{broken}</>;',
      '}',
      '',
    ].join('\n')
  );

  run('git', ['add', '--', tempFile]);

  const result = spawnSync(
    'bunx',
    ['lefthook', 'run', 'pre-commit', '--force', '--no-tty'],
    {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }
  );

  if (result.status === 0) {
    throw new Error(
      'Expected pre-commit hook to fail for intentionally broken staged code, but it exited with status 0.'
    );
  }

  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  console.log('\nPre-commit fail path verified successfully.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  cleanup();
  process.exit(1);
}

cleanup();
