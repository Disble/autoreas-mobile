import type { SQLiteDatabase } from 'expo-sqlite';
import { runMigrations } from '../../../src/infrastructure/db/client/client.helpers';
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

/** Reads the `sync_cycle_lock` column names off a repaired adapter. */
async function readSyncCycleLockColumns(rawDb: SQLiteDatabase): Promise<string[]> {
  const columns = await rawDb.getAllAsync<{ name: string }>(
    'PRAGMA table_info(sync_cycle_lock)',
  );

  return columns.map((column) => column.name);
}

/**
 * `sync_cycle_lock` reaches installed devices ONLY through the repair pipeline: the table is
 * created by `ensureSyncCycleLockTable`'s `CREATE TABLE IF NOT EXISTS`, which is a no-op on a
 * database that already carries an older shape. The `fence` column (the per-claim token a
 * reclaimed lease checks before honoring an owner's writes) therefore needs its own repair
 * twin, or it exists on fresh installs only while every installed device keeps writing
 * unfenced -- the silent-failure class `migration-repair-parity.test.ts` documents.
 */
describe('ensureSyncCycleLockColumns (sync_cycle_lock.fence repair twin)', () => {
  it('adds the fence column to a sync_cycle_lock table that predates it', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);

    // The exact pre-fence shape an installed device carries today.
    await adapter.execAsync(
      'CREATE TABLE IF NOT EXISTS sync_cycle_lock (' +
        'id INTEGER PRIMARY KEY, ' +
        'owner TEXT NOT NULL, ' +
        'expires_at INTEGER NOT NULL)',
    );

    await runMigrations(adapter);

    await expect(readSyncCycleLockColumns(adapter)).resolves.toContain('fence');
  });

  it('ships the fence column on a fresh table and stays idempotent across reruns', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);

    await runMigrations(adapter);
    await expect(readSyncCycleLockColumns(adapter)).resolves.toContain('fence');

    // A second preparation must not fail on the column already existing.
    await runMigrations(adapter);
    await expect(readSyncCycleLockColumns(adapter)).resolves.toContain('fence');
  });
});
