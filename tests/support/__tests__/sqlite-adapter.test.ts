import type { SQLiteDatabase } from 'expo-sqlite';
import { applyMigrationFiles, createTestSqliteAdapter } from '../sqlite-adapter.helpers';

/** Rows of `sqlite_master`, used to assert a table exists after migrations run. */
interface SqliteMasterRow {
  name: string;
}

describe('createTestSqliteAdapter', () => {
  let adapter: SQLiteDatabase;

  beforeEach(() => {
    adapter = createTestSqliteAdapter();
  });

  it('exposes a stable databasePath identity per instance', () => {
    const other = createTestSqliteAdapter();

    expect(adapter.databasePath).toEqual(expect.any(String));
    expect(adapter.databasePath).not.toBe(other.databasePath);
  });

  it('execAsync executes DDL that later statements can rely on', async () => {
    await adapter.execAsync('CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');

    const rows = await adapter.getAllAsync<{ id: number; label: string }>(
      'SELECT id, label FROM widgets',
    );

    expect(rows).toEqual([]);
  });

  it('execSync executes DDL synchronously', () => {
    adapter.execSync('CREATE TABLE sync_widgets (id INTEGER PRIMARY KEY)');

    expect(() => adapter.execSync('INSERT INTO sync_widgets (id) VALUES (1)')).not.toThrow();
  });

  it('runAsync inserts a row and reports the generated id and change count', async () => {
    await adapter.execAsync('CREATE TABLE widgets (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL)');

    const result = await adapter.runAsync(
      'INSERT INTO widgets (label) VALUES (?)',
      'first widget',
    );

    expect(result.lastInsertRowId).toBe(1);
    expect(result.changes).toBe(1);
  });

  it('getAllAsync returns every matching row as an object keyed by column name', async () => {
    await adapter.execAsync('CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
    await adapter.runAsync('INSERT INTO widgets (id, label) VALUES (?, ?)', 1, 'alpha');
    await adapter.runAsync('INSERT INTO widgets (id, label) VALUES (?, ?)', 2, 'beta');

    const rows = await adapter.getAllAsync<{ id: number; label: string }>(
      'SELECT id, label FROM widgets ORDER BY id ASC',
    );

    expect(rows).toEqual([
      { id: 1, label: 'alpha' },
      { id: 2, label: 'beta' },
    ]);
  });

  it('getFirstAsync returns the first matching row, or null when nothing matches', async () => {
    await adapter.execAsync('CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
    await adapter.runAsync('INSERT INTO widgets (id, label) VALUES (?, ?)', 1, 'alpha');

    const found = await adapter.getFirstAsync<{ id: number; label: string }>(
      'SELECT id, label FROM widgets WHERE id = ?',
      1,
    );
    const missing = await adapter.getFirstAsync<{ id: number; label: string }>(
      'SELECT id, label FROM widgets WHERE id = ?',
      999,
    );

    expect(found).toEqual({ id: 1, label: 'alpha' });
    expect(missing).toBeNull();
  });

  it('throws an error naming the missing member for any unimplemented SQLiteDatabase method', () => {
    const unimplemented = adapter as unknown as { closeAsync: () => Promise<void> };

    expect(() => unimplemented.closeAsync).toThrow(/closeAsync/);
  });
});

describe('applyMigrationFiles', () => {
  it('applies every production migration file and creates the tables slice 1 depends on', async () => {
    const adapter = createTestSqliteAdapter();

    await applyMigrationFiles(adapter);

    const tables = await adapter.getAllAsync<SqliteMasterRow>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC",
    );
    const tableNames = tables.map((table) => table.name);

    expect(tableNames).toEqual(
      expect.arrayContaining([
        'animes',
        'operation_log',
        'bridge_config',
        'season_rating_queue',
        'pending_remote_changes',
      ]),
    );
  });
});

describe('adapter proxy passthrough', () => {
  it('does not throw when the runtime probes it for thenability', async () => {
    const adapter = createTestSqliteAdapter();

    // `await`/`Promise.resolve` read `.then` to decide whether a value is a thenable. Throwing
    // there would surface far from the await that caused it, so probe members fall through.
    await expect(Promise.resolve(adapter)).resolves.toBe(adapter);
    expect(() => JSON.stringify({ path: adapter.databasePath })).not.toThrow();
  });
});

describe('migration files are only half the production schema', () => {
  it('leaves sync_cycle_lock and active_season_cache absent, because no migration creates them', async () => {
    const adapter = createTestSqliteAdapter();

    await applyMigrationFiles(adapter);

    const tables = await adapter.getAllAsync<SqliteMasterRow>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const tableNames = tables.map((table) => table.name);

    // Both are required by REQUIRED_SCHEMA_TABLES but are created imperatively by
    // `prepareDatabaseSchema`'s ensure* steps, never by a migration file. This assertion pins
    // the gap so a behaviour test never dies on a missing table several layers from the cause.
    expect(tableNames).not.toContain('sync_cycle_lock');
    expect(tableNames).not.toContain('active_season_cache');
  });
});
