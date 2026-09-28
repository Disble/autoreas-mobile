import { readFileSync } from 'node:fs';
import path from 'node:path';
import migrationJournal from '../../../src/infrastructure/db/migrations/meta/_journal.json';

/**
 * Guards the Kotlin twin of `EXPECTED_SCHEMA_READINESS_VERSION`.
 *
 * `src/infrastructure/db/startup/startup.constants.ts` derives the readiness stamp from the
 * migration journal (`migrationJournal.entries.length`), and `prepareForegroundDatabase` writes it
 * as its FINAL schema-preparation step. The native module cannot import TypeScript, so it carries a
 * literal twin in
 * `modules/sync-engine/android/src/main/java/expo/modules/syncengine/SyncEngineDatabases.kt`, which
 * the native readiness gate compares against `PRAGMA user_version`.
 *
 * If a new migration bumps the journal without bumping that literal, the native owner would refuse
 * every background tick forever -- and `native-schema-readiness-twin` is the only test that can see
 * the Kotlin source at all. It reads that file as text and fails on the drift, so the mistake is
 * caught here instead of shipping as a silent native outage.
 */
const KOTLIN_DATABASES_SOURCE = path.resolve(
  __dirname,
  '../../../modules/sync-engine/android/src/main/java/expo/modules/syncengine/SyncEngineDatabases.kt',
);

describe('native schema readiness twin', () => {
  it('keeps the Kotlin readiness constant equal to the migration journal length', () => {
    const source = readFileSync(KOTLIN_DATABASES_SOURCE, 'utf8');
    const match = source.match(/const\s+val\s+EXPECTED_SCHEMA_READINESS_VERSION\s*=\s*(\d+)/);

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(migrationJournal.entries.length);
  });

  it('pins the journal length the twin mirrors, so a silent migration change is caught here', () => {
    // Mirrors the literal assertion in `tests/infrastructure/db/startup.helpers.test.ts`: adding
    // migration `0016` moves this to 17 and fails BOTH the TypeScript constant and the Kotlin twin.
    expect(migrationJournal.entries.length).toBe(16);
  });
});
