import type { SQLiteDatabase } from 'expo-sqlite';
import { readUnresolvedKeyCount } from '../../../src/features/sync';
import { pruneOperationLog } from '../../../src/features/sync/operation-log-retention.helpers';
import { openPairedDatabase, readOperationRows } from './unresolved-fixtures.helpers';

// Same seam as `unresolved-keys.behaviour.test.ts`: only the drizzle factory is swapped.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** One day in milliseconds, for seeding rows of a given age. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Inserts `count` outbox rows of `status`, one per anime (`<prefix>-1` .. `<prefix>-<count>`),
 * created at `createdAt + i` so their age order is the insertion order.
 */
async function insertRows(
  adapter: SQLiteDatabase,
  options: { readonly count: number; readonly status: string; readonly createdAt: number; readonly prefix: string },
) {
  await adapter.runAsync(
    [
      'WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?)',
      'INSERT INTO operation_log (anime_id, operation, payload, status, created_at)',
      "SELECT ? || '-' || i, 'update', '{}', ?, ? + i FROM seq",
    ].join(' '),
    options.count,
    options.prefix,
    options.status,
    options.createdAt,
  );
}

/** Reads every outbox row's anime id back, oldest first. */
async function readAnimeIds(adapter: SQLiteDatabase): Promise<string[]> {
  const rows = await adapter.getAllAsync<{ anime_id: string }>('SELECT anime_id FROM operation_log ORDER BY id');

  return rows.map((row) => row.anime_id);
}

/** Counts the stored outbox rows per status. */
async function countByStatus(adapter: SQLiteDatabase): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const row of await readOperationRows(adapter)) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  return counts;
}

describe('an unresolved anime edit is never pruned (ADR 009 R-16b, L19)', () => {
  it('keeps a 31-day-old dead_letter and conflict_exhausted row, and both keys stay counted', async () => {
    const adapter = await openPairedDatabase({ episodes: [] });
    const monthAgo = Date.now() - 31 * DAY_MS;
    await insertRows(adapter, { count: 1, status: 'dead_letter', createdAt: monthAgo, prefix: 'dead' });
    await insertRows(adapter, { count: 1, status: 'conflict_exhausted', createdAt: monthAgo, prefix: 'conflict' });

    await pruneOperationLog(adapter);

    expect(await countByStatus(adapter)).toEqual({ dead_letter: 1, conflict_exhausted: 1 });
    expect(await readUnresolvedKeyCount(adapter)).toBe(2);
  });

  it('keeps more than 500 dead_letter and conflict_exhausted rows, and every key stays counted', async () => {
    const adapter = await openPairedDatabase({ episodes: [] });
    const now = Date.now();
    await insertRows(adapter, { count: 501, status: 'dead_letter', createdAt: now, prefix: 'dead' });
    await insertRows(adapter, { count: 501, status: 'conflict_exhausted', createdAt: now, prefix: 'conflict' });

    await pruneOperationLog(adapter);

    expect(await countByStatus(adapter)).toEqual({ dead_letter: 501, conflict_exhausted: 501 });
    expect(await readUnresolvedKeyCount(adapter)).toBe(1002);
  });
});

describe('synced history keeps its 7-day / 1000-row retention', () => {
  it('deletes a synced row older than 7 days and keeps one within them', async () => {
    const adapter = await openPairedDatabase({ episodes: [] });
    const now = Date.now();
    await insertRows(adapter, { count: 1, status: 'synced', createdAt: now - 8 * DAY_MS, prefix: 'old' });
    await insertRows(adapter, { count: 1, status: 'synced', createdAt: now - 6 * DAY_MS, prefix: 'recent' });

    await expect(pruneOperationLog(adapter)).resolves.toEqual({ deletedSyncedCount: 1 });

    expect(await readAnimeIds(adapter)).toEqual(['recent-1']);
  });

  it('keeps only the newest 1000 synced rows, deleting the oldest first', async () => {
    const adapter = await openPairedDatabase({ episodes: [] });
    await insertRows(adapter, { count: 1002, status: 'synced', createdAt: Date.now(), prefix: 'synced' });

    await expect(pruneOperationLog(adapter)).resolves.toEqual({ deletedSyncedCount: 2 });

    const remaining = await readAnimeIds(adapter);
    expect(remaining).toHaveLength(1000);
    expect(remaining).not.toContain('synced-1');
    expect(remaining).not.toContain('synced-2');
    expect(remaining).toContain('synced-1002');
  });
});
