import { createSqliteProxyCallback } from '../drizzle-test-factory.helpers';
import { applyMigrationFiles, createTestSqliteAdapter } from '../sqlite-adapter.helpers';

/** Builds a migrated adapter with one seeded `bridge_config` row, the fixture every case uses. */
async function seededAdapter() {
  const adapter = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  await adapter.runAsync(
    'INSERT INTO bridge_config (id, ip, port) VALUES (1, ?, ?)',
    '127.0.0.1',
    8080,
  );

  return adapter;
}

describe('createSqliteProxyCallback', () => {
  it('run executes a write statement against the real table and returns empty rows', async () => {
    const adapter = await seededAdapter();
    const callback = createSqliteProxyCallback(adapter);

    const result = await callback(
      'UPDATE bridge_config SET port = ? WHERE id = ?',
      [9090, 1],
      'run',
    );

    expect(result).toEqual({ rows: [] });
    const persisted = await adapter.getFirstAsync<{ port: number }>(
      'SELECT port FROM bridge_config WHERE id = ?',
      1,
    );
    expect(persisted?.port).toBe(9090);
  });

  it('get returns the row itself as a flat positional array, not wrapped in an outer array', async () => {
    const adapter = await seededAdapter();
    const callback = createSqliteProxyCallback(adapter);

    const result = await callback(
      'SELECT id, ip, port FROM bridge_config WHERE id = ?',
      [1],
      'get',
    );

    // `mapGetResult` in drizzle's proxy session does `const row = rows`, so `rows` IS the row.
    // Wrapping it would hand drizzle a row whose first column is an array.
    expect(result).toEqual({ rows: [1, '127.0.0.1', 8080] });
  });

  it('get returns empty rows when nothing matches', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    const callback = createSqliteProxyCallback(adapter);

    const result = await callback(
      'SELECT id, ip, port FROM bridge_config WHERE id = ?',
      [999],
      'get',
    );

    expect(result).toEqual({ rows: [] });
  });

  it('all returns every matching row as positional arrays in select order', async () => {
    const adapter = await seededAdapter();
    await adapter.runAsync(
      'INSERT INTO bridge_config (id, ip, port) VALUES (2, ?, ?)',
      '10.0.0.2',
      9000,
    );
    const callback = createSqliteProxyCallback(adapter);

    const result = await callback('SELECT port, ip, id FROM bridge_config ORDER BY id', [], 'all');

    // Column order follows the SELECT, not the table definition.
    expect(result).toEqual({ rows: [[8080, '127.0.0.1', 1], [9000, '10.0.0.2', 2]] });
  });

  it('values returns every matching row as positional arrays of column values', async () => {
    const adapter = await seededAdapter();
    const callback = createSqliteProxyCallback(adapter);

    const result = await callback('SELECT id, ip, port FROM bridge_config', [], 'values');

    expect(result).toEqual({ rows: [[1, '127.0.0.1', 8080]] });
  });

  it('keeps both positions when the same column name is selected twice', async () => {
    const adapter = await seededAdapter();
    const callback = createSqliteProxyCallback(adapter);

    const result = await callback('SELECT id, id FROM bridge_config WHERE id = ?', [1], 'all');

    // A row keyed by column name would collapse these into one entry and shift every later
    // column. Drizzle emits repeated names on joins, so this is the case that discriminates a
    // positional implementation from an object-based one.
    expect(result).toEqual({ rows: [[1, 1]] });
  });
});
