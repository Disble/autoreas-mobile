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

/** The table an installed device still holds: created only by the retired repair step. */
const RETIRED_TABLE = 'active_season_cache';

/** Reads every table name off a repaired adapter. */
async function readTableNames(rawDb: SQLiteDatabase): Promise<string[]> {
  const tables = await rawDb.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );

  return tables.map((table) => table.name);
}

/**
 * Season state moved to `animes.season` and `bridge_config.season_mode`, so the active-season
 * cache has no reader or writer left. No migration ever created it, so only a repair step can
 * remove it from installed devices.
 */
describe('dropActiveSeasonCacheTable (repair step)', () => {
  it('drops the cache an installed device still holds, with its row', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    await adapter.execAsync(
      `CREATE TABLE ${RETIRED_TABLE} (id INTEGER PRIMARY KEY CHECK (id = 1), ` +
        'season_id TEXT NOT NULL, candidates_json TEXT NOT NULL)',
    );
    await adapter.runAsync(
      `INSERT INTO ${RETIRED_TABLE} (id, season_id, candidates_json) VALUES (1, 'season-1', '[]')`,
    );

    await runMigrations(adapter);

    await expect(readTableNames(adapter)).resolves.not.toContain(RETIRED_TABLE);
  });

  it('is a no-op on a database without it, and stays one on a rerun', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);

    await runMigrations(adapter);
    const tablesAfterFirstRun = await readTableNames(adapter);
    await runMigrations(adapter);

    await expect(readTableNames(adapter)).resolves.toEqual(tablesAfterFirstRun);
    expect(tablesAfterFirstRun).not.toContain(RETIRED_TABLE);
    expect(tablesAfterFirstRun).toEqual(expect.arrayContaining([...REQUIRED_SCHEMA_TABLES]));
  });

  it('is no longer a table readiness requires', () => {
    expect(REQUIRED_SCHEMA_TABLES).not.toContain(RETIRED_TABLE);
    expect(REQUIRED_SCHEMA_TABLES).toHaveLength(7);
  });
});
