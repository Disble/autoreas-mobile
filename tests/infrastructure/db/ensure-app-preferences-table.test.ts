import type { SQLiteDatabase } from 'expo-sqlite';
import { runMigrations } from '../../../src/infrastructure/db/client/client.helpers';
import { REQUIRED_SCHEMA_TABLES } from '../../../src/infrastructure/db/startup/startup.constants';
import {
  applyMigrationFiles,
  createTestSqliteAdapter,
} from '../../support/sqlite-adapter.helpers';

// The ONLY production module mocked in this suite: drizzle is handed a node:sqlite proxy
// handle instead of expo-sqlite, and the migrator is a no-op because `applyMigrationFiles`
// already ran the same SQL. `runMigrations` still executes its idempotent repair steps for
// real, which is the mechanism under test here.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => async () => undefined,
  getOpenDatabaseSync: () => () => undefined,
}));

/** Reads the `app_preferences` column names off a repaired adapter. */
async function readAppPreferencesColumns(rawDb: SQLiteDatabase): Promise<string[]> {
  const columns = await rawDb.getAllAsync<{ name: string }>('PRAGMA table_info(app_preferences)');

  return columns.map((column) => column.name);
}

/**
 * `app_preferences` exists in no migration file, like `active_season_cache` and
 * `sync_cycle_lock`: adding a journal entry would bump `EXPECTED_SCHEMA_READINESS_VERSION` and its
 * Kotlin twin. Installed devices reach it because the new `REQUIRED_SCHEMA_TABLES` entry fails
 * readiness validation at the current version, which falls through to `runMigrations`.
 */
describe('ensureAppPreferencesTable (repair-only singleton table)', () => {
  it('creates app_preferences on a database that lacks it', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);

    await expect(readAppPreferencesColumns(adapter)).resolves.toEqual([]);

    await runMigrations(adapter);

    await expect(readAppPreferencesColumns(adapter)).resolves.toEqual([
      'id',
      'battery_prompt_shown_at',
      'battery_reminder_shown_at',
    ]);
  });

  it('stays idempotent across reruns and keeps existing rows', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    await runMigrations(adapter);
    await adapter.runAsync(
      'INSERT INTO app_preferences (id, battery_prompt_shown_at) VALUES (1, 1234)',
    );

    await runMigrations(adapter);

    const row = await adapter.getFirstAsync<{ battery_prompt_shown_at: number }>(
      'SELECT battery_prompt_shown_at FROM app_preferences WHERE id = 1',
    );
    expect(row?.battery_prompt_shown_at).toBe(1234);
  });

  it('lists app_preferences as a required table so readiness forces the repair on installed devices', () => {
    expect(REQUIRED_SCHEMA_TABLES).toContain('app_preferences');
  });
});
