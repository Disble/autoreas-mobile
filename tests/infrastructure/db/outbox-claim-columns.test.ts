import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

/** Reads the column names SQLite actually reports for one table. */
async function readColumnNames(table: string): Promise<readonly string[]> {
  const adapter = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  const columns = await adapter.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);

  return columns.map((column) => column.name);
}

describe('migration 0018 on a fresh install (ADR 009 claims and unresolved reason)', () => {
  it('gives operation_log the claim owner, claim time and unresolved reason columns', async () => {
    await expect(readColumnNames('operation_log')).resolves.toEqual(
      expect.arrayContaining(['claim_owner', 'claimed_at', 'unresolved_reason']),
    );
  });

  it('gives season_rating_queue the claim owner and claim time columns', async () => {
    await expect(readColumnNames('season_rating_queue')).resolves.toEqual(
      expect.arrayContaining(['claim_owner', 'claimed_at']),
    );
  });

  it('leaves every pre-existing queued row unclaimed and not unresolved', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    await adapter.runAsync(
      "INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES ('a', 'update', '{}', 'pending', 1)",
    );

    const row = await adapter.getFirstAsync<Record<string, unknown>>(
      'SELECT claim_owner, claimed_at, unresolved_reason FROM operation_log',
    );

    expect(row).toEqual({ claim_owner: null, claimed_at: null, unresolved_reason: null });
  });
});
