import type { SQLiteDatabase } from 'expo-sqlite';
import { prepareForegroundDatabase } from '../../../src/infrastructure/db/startup/startup.helpers';
import { GATE_MIGRATOR_LOG } from '../../support/migration-gate.constants';
import { openReadiness20Device, readUserVersion } from '../../support/migration-gate.helpers';
import { createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

// The migrator is drizzle's REAL single-scalar gate: on an installed device it applies nothing, so
// the repair steps alone must drop the retired season cache and add the season columns (L13).
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/migration-gate.helpers').createUnwrappingDrizzleFactory(),
  getDrizzleMigrator: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/migration-gate.helpers').createGateMigrator(),
  getOpenDatabaseSync: () => () => undefined,
}));

/** The season cache exactly as the builds before readiness 22 created it, with one cached season. */
const SHIPPED_ACTIVE_SEASON_CACHE_SQL = [
  'CREATE TABLE IF NOT EXISTS active_season_cache (id INTEGER PRIMARY KEY CHECK (id = 1), season_id TEXT NOT NULL, candidates_json TEXT NOT NULL)',
  `INSERT INTO active_season_cache (id, season_id, candidates_json) VALUES (1, 'season-1', '{}')`,
];

/** Builds an installed device that still holds the retired season cache and a paired bridge. */
async function openDeviceWithSeasonCache(): Promise<SQLiteDatabase> {
  const adapter = await openReadiness20Device();
  for (const sql of SHIPPED_ACTIVE_SEASON_CACHE_SQL) {
    await adapter.execAsync(sql);
  }
  await adapter.runAsync(
    "INSERT INTO bridge_config (id, ip, port, token, device_id, last_changelog_id) VALUES (1, '192.168.0.10', 8080, 'tok', 'dev-1', 9)",
  );
  await adapter.runAsync(
    "INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez) VALUES ('anime-1', 'Uno', 0, 4, 1, 1)",
  );

  return adapter;
}

/** Reads every table name, sorted. */
async function readTables(adapter: SQLiteDatabase): Promise<string[]> {
  const rows = await adapter.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_sequence' ORDER BY name",
  );

  return rows.map((row) => row.name);
}

/** Reads one table's column names, sorted. */
async function readColumns(adapter: SQLiteDatabase, table: string): Promise<string[]> {
  const rows = await adapter.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);

  return rows.map((row) => row.name).sort();
}

describe('active_season_cache retirement through the real drizzle gate', () => {
  beforeEach(() => {
    GATE_MIGRATOR_LOG.length = 0;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('drops the cache and adds the season columns while the gate applies nothing, keeping the data', async () => {
    const adapter = await openDeviceWithSeasonCache();

    await prepareForegroundDatabase(adapter);

    expect(GATE_MIGRATOR_LOG).toEqual([[]]);
    expect(await readUserVersion(adapter)).toBe(22);
    expect(await readTables(adapter)).not.toContain('active_season_cache');
    expect(await adapter.getFirstAsync("SELECT season FROM animes WHERE _id = 'anime-1'")).toEqual({ season: null });
    expect(await adapter.getFirstAsync('SELECT season_mode, last_changelog_id FROM bridge_config WHERE id = 1')).toEqual({
      season_mode: 0,
      last_changelog_id: 9,
    });
  });

  it('leaves the installed device with the same tables and season columns as a fresh install', async () => {
    const upgraded = await openDeviceWithSeasonCache();
    const fresh = createTestSqliteAdapter();

    await prepareForegroundDatabase(upgraded);
    await prepareForegroundDatabase(fresh);

    expect(await readTables(upgraded)).toEqual(await readTables(fresh));
    for (const table of ['animes', 'bridge_config']) {
      expect(await readColumns(upgraded, table)).toEqual(await readColumns(fresh, table));
    }
  });

  it('makes a second startup a no-op that never reaches the migrator', async () => {
    const adapter = await openDeviceWithSeasonCache();
    await prepareForegroundDatabase(adapter);
    GATE_MIGRATOR_LOG.length = 0;

    await prepareForegroundDatabase(adapter);

    expect(GATE_MIGRATOR_LOG).toEqual([]);
    expect(await readTables(adapter)).not.toContain('active_season_cache');
  });
});
