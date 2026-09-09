import type { SQLiteDatabase } from 'expo-sqlite';
import { readOperationLogConvergence } from '../../../../src/features/sync/operation-log-convergence.helpers';
import { RECONCILE_BACKLOG_BATCH_LIMIT } from '../../../../src/features/sync/reconcile.constants';
import {
  applyMigrationFiles,
  createTestSqliteAdapter,
} from '../../../support/sqlite-adapter.helpers';

/** Inserts one `operation_log` row with the given status and creation timestamp. */
async function insertOperationLogRow(
  adapter: SQLiteDatabase,
  status: string,
  createdAt: number,
): Promise<void> {
  await adapter.runAsync(
    'INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES (?, ?, ?, ?, ?)',
    'anime-1',
    'update',
    '{}',
    status,
    createdAt,
  );
}

describe('readOperationLogConvergence', () => {
  it('reports a dead_letter count matching those rows', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    await insertOperationLogRow(adapter, 'dead_letter', 100);
    await insertOperationLogRow(adapter, 'dead_letter', 200);
    await insertOperationLogRow(adapter, 'pending', 300);

    const result = await readOperationLogConvergence(adapter, 1_000);

    expect(result.deadLetterCount).toBe(2);
  });

  it('reports a conflict_exhausted count matching those rows', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    await insertOperationLogRow(adapter, 'conflict_exhausted', 100);
    await insertOperationLogRow(adapter, 'dead_letter', 200);

    const result = await readOperationLogConvergence(adapter, 1_000);

    expect(result.conflictExhaustedCount).toBe(1);
  });

  it('reports rows stuck in processing', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    await insertOperationLogRow(adapter, 'processing', 100);
    await insertOperationLogRow(adapter, 'processing', 200);
    await insertOperationLogRow(adapter, 'pending', 300);

    const result = await readOperationLogConvergence(adapter, 1_000);

    expect(result.stuckProcessingCount).toBe(2);
  });

  it('reports oldestPendingAgeMs as null on an empty queue', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);

    const result = await readOperationLogConvergence(adapter, 1_000);

    expect(result.oldestPendingAgeMs).toBeNull();
  });

  it("reports the oldest pending-or-processing row's age as now minus its creation time", async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    await insertOperationLogRow(adapter, 'pending', 400);
    await insertOperationLogRow(adapter, 'processing', 250);
    await insertOperationLogRow(adapter, 'synced', 1);

    const result = await readOperationLogConvergence(adapter, 1_000);

    expect(result.oldestPendingAgeMs).toBe(750);
  });

  it('reports hasMore as false when the true backlog is at the batch limit', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    for (let index = 0; index < RECONCILE_BACKLOG_BATCH_LIMIT; index += 1) {
      await insertOperationLogRow(adapter, 'pending', index);
    }

    const result = await readOperationLogConvergence(adapter, 1_000_000);

    expect(result.pendingRowCount).toBe(RECONCILE_BACKLOG_BATCH_LIMIT);
    expect(result.hasMore).toBe(false);
  });

  it('reports hasMore as true when the true backlog exceeds the batch limit', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    for (let index = 0; index < RECONCILE_BACKLOG_BATCH_LIMIT + 1; index += 1) {
      await insertOperationLogRow(adapter, 'pending', index);
    }

    const result = await readOperationLogConvergence(adapter, 1_000_000);

    expect(result.pendingRowCount).toBe(RECONCILE_BACKLOG_BATCH_LIMIT + 1);
    expect(result.hasMore).toBe(true);
  });
});
