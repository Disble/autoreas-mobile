import type { SQLiteDatabase } from 'expo-sqlite';
import { withLocalWrite } from '../../../../src/infrastructure/db/client/client.helpers';
import {
  DEFAULT_OPERATION_LOG_RETENTION_POLICY,
  OPERATION_LOG_RETENTION_DAY_IN_MS,
} from '../../../../src/features/sync/operation-log-retention.constants';
import {
  countOperationLogBacklogRows,
  countPendingOperationLog,
  pruneOperationLog,
  readOperationLogBacklog,
} from '../../../../src/features/sync/operation-log-retention.helpers';
import type { OperationLogCountRow } from '../../../../src/features/sync/operation-log-retention.types';

jest.mock('../../../../src/infrastructure/db/client/client.helpers', () => ({
  withLocalWrite: jest.fn(),
}));

describe('operation log retention helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (withLocalWrite as jest.Mock).mockImplementation(
      async (
        rawDb: SQLiteDatabase,
        task: (db: unknown, tx: SQLiteDatabase) => Promise<unknown>,
      ) => task({}, rawDb),
    );
  });

  it('reads a bounded backlog ordered from oldest to newest', async () => {
    const rows = [
      {
        id: 10,
        animeId: 'anime-1',
        operation: 'update',
        payload: '{}',
        status: 'pending',
        createdAt: 100,
      },
    ];
    const rawDb = buildRawDb({
      getAllAsync: jest.fn().mockResolvedValue(rows),
    });

    const result = await readOperationLogBacklog(rawDb, {
      status: ['pending', 'processing'],
      limit: 200,
      orderBy: 'oldest_first',
    });

    expect(result).toEqual(rows);
    expect(rawDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY created_at ASC, id ASC LIMIT ?'),
      'pending',
      'processing',
      200,
    );
  });

  it('counts as 0 when the COUNT query returns no row', async () => {
    const rawDb = buildRawDb({ getFirstAsync: jest.fn().mockResolvedValue(null) });

    await expect(countPendingOperationLog(rawDb)).resolves.toBe(0);
  });

  it('returns an empty backlog without querying when status is empty', async () => {
    const rawDb = buildRawDb({ getAllAsync: jest.fn().mockResolvedValue([{ id: 1 }]) });

    const result = await readOperationLogBacklog(rawDb, {
      status: [],
      limit: 200,
      orderBy: 'oldest_first',
    });

    expect(result).toEqual([]);
    expect(rawDb.getAllAsync).not.toHaveBeenCalled();
  });

  it('returns an empty backlog without querying when limit is not positive', async () => {
    const rawDb = buildRawDb({ getAllAsync: jest.fn().mockResolvedValue([{ id: 1 }]) });

    const result = await readOperationLogBacklog(rawDb, {
      status: ['pending'],
      limit: 0,
      orderBy: 'oldest_first',
    });

    expect(result).toEqual([]);
    expect(rawDb.getAllAsync).not.toHaveBeenCalled();
  });

  it('counts pending operation-log rows without materializing the queue', async () => {
    const rawDb = buildRawDb({
      getFirstAsync: jest.fn().mockResolvedValue({ count: 27 }),
    });

    await expect(countPendingOperationLog(rawDb)).resolves.toBe(27);
    expect(rawDb.getFirstAsync).toHaveBeenCalledWith(
      'SELECT COUNT(*) AS count FROM operation_log WHERE status = ?',
      'pending',
    );
  });

  it('prunes only synced rows using ttl first and max-count second', async () => {
    // Fixture is derived from the DEFAULT policy so this stays correct as the
    // policy's ttlDays/maxCount values evolve: overflow only fires strictly
    // above maxCount (`Math.max(0, currentCount - maxCount)`).
    const now = 1_000_000;
    const syncedCount = DEFAULT_OPERATION_LOG_RETENTION_POLICY.synced.maxCount + 1;
    const syncedCutoff =
      now - DEFAULT_OPERATION_LOG_RETENTION_POLICY.synced.ttlDays * OPERATION_LOG_RETENTION_DAY_IN_MS;

    const rawDb = buildRawDb({
      getFirstAsync: jest.fn().mockResolvedValueOnce({ count: syncedCount }),
      runAsync: jest
        .fn()
        .mockResolvedValueOnce({ changes: 2 })
        .mockResolvedValueOnce({ changes: 1 }),
    });

    const result = await pruneOperationLog(rawDb, {
      ...DEFAULT_OPERATION_LOG_RETENTION_POLICY,
      now: () => now,
    });

    // Both deletes must route through the file-keyed write door, not raw `rawDb.runAsync`
    // called outside it -- a write bypassing the door is a defect (local-write-serialization spec).
    expect(withLocalWrite).toHaveBeenCalledWith(rawDb, expect.any(Function));

    expect(result).toEqual({ deletedSyncedCount: 3 });
    expect(rawDb.getFirstAsync).toHaveBeenCalledWith(
      'SELECT COUNT(*) AS count FROM operation_log WHERE status = ?',
      'synced',
    );
    expect(rawDb.runAsync).toHaveBeenCalledTimes(2);
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("WHERE status = 'synced' AND created_at < ?"),
      syncedCutoff,
    );
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/WHERE status = 'synced'\s+ORDER BY created_at ASC, id ASC\s+LIMIT \?/),
      1,
    );
  });

  it('skips the max-count delete when synced rows are still under the cap after ttl pruning', async () => {
    const rawDb = buildRawDb({
      getFirstAsync: jest.fn().mockResolvedValueOnce({ count: 1 }),
      runAsync: jest.fn().mockResolvedValueOnce({ changes: 0 }),
    });

    const result = await pruneOperationLog(rawDb, {
      ...DEFAULT_OPERATION_LOG_RETENTION_POLICY,
      now: () => 1_000_000,
    });

    expect(result).toEqual({ deletedSyncedCount: 0 });
    // Only the TTL delete ran; the max-count delete did not fire.
    expect(rawDb.runAsync).toHaveBeenCalledTimes(1);
  });

  it('defaults to DEFAULT_OPERATION_LOG_RETENTION_POLICY when the caller omits one', async () => {
    const rawDb = buildRawDb();

    const result = await pruneOperationLog(rawDb);

    expect(result).toEqual({ deletedSyncedCount: 0 });
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("WHERE status = 'synced' AND created_at < ?"),
      expect.any(Number),
    );
  });
});

describe('readOperationLogBacklog dedupeBy: anime_id', () => {
  it('is byte-identical to today\'s flat query when dedupeBy is absent', async () => {
    const rawDb = buildRawDb({ getAllAsync: jest.fn().mockResolvedValue([]) });

    await readOperationLogBacklog(rawDb, {
      status: ['pending', 'processing'],
      limit: 200,
      orderBy: 'oldest_first',
    });

    const [query] = (rawDb.getAllAsync as jest.Mock).mock.calls[0];
    expect(query).not.toContain('ROW_NUMBER');
    expect(query).not.toContain('animeRank');
  });

  it('applies a per-anime ROW_NUMBER window, ordered oldest-first inside the partition', async () => {
    const rawDb = buildRawDb({ getAllAsync: jest.fn().mockResolvedValue([]) });

    await readOperationLogBacklog(rawDb, {
      status: ['pending', 'processing'],
      limit: 3,
      orderBy: 'oldest_first',
      dedupeBy: 'anime_id',
    });

    expect(rawDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringMatching(
        /ROW_NUMBER\(\)\s+OVER\s+\(\s*PARTITION BY anime_id ORDER BY created_at ASC, id ASC\s*\)/,
      ),
      'pending',
      'processing',
      3,
    );
  });

  it('filters to rank 1 BEFORE the outer LIMIT, so dedup never shrinks the batch below its bound', async () => {
    const rawDb = buildRawDb({ getAllAsync: jest.fn().mockResolvedValue([]) });

    await readOperationLogBacklog(rawDb, {
      status: ['pending', 'processing'],
      limit: 3,
      orderBy: 'oldest_first',
      dedupeBy: 'anime_id',
    });

    const [query] = (rawDb.getAllAsync as jest.Mock).mock.calls[0];
    // The `WHERE animeRank = 1` filter and the outer `ORDER BY`/`LIMIT` must both sit OUTSIDE
    // the windowed subquery -- the window runs over every matching row before either applies,
    // which is what keeps a batch of N distinct animes intact instead of shrinking below N.
    expect(query).toMatch(/\)\s*WHERE animeRank = 1\s+ORDER BY createdAt ASC, id ASC\s+LIMIT \?/);
  });

  it('per-anime FIFO holds: the partition orders by created_at then id, so a later op for the same anime can never rank ahead of an earlier one', async () => {
    const rawDb = buildRawDb({ getAllAsync: jest.fn().mockResolvedValue([]) });

    await readOperationLogBacklog(rawDb, {
      status: ['pending', 'processing'],
      limit: 200,
      orderBy: 'oldest_first',
      dedupeBy: 'anime_id',
    });

    const [query] = (rawDb.getAllAsync as jest.Mock).mock.calls[0];
    expect(query).toContain('PARTITION BY anime_id ORDER BY created_at ASC, id ASC');
  });
});

describe('countOperationLogBacklogRows', () => {
  it('sums row counts across every given status', async () => {
    const rawDb = buildRawDb({
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ count: 150 })
        .mockResolvedValueOnce({ count: 50 }),
    });

    await expect(
      countOperationLogBacklogRows(rawDb, ['pending', 'processing']),
    ).resolves.toBe(200);
    expect(rawDb.getFirstAsync).toHaveBeenCalledWith(
      'SELECT COUNT(*) AS count FROM operation_log WHERE status = ?',
      'pending',
    );
    expect(rawDb.getFirstAsync).toHaveBeenCalledWith(
      'SELECT COUNT(*) AS count FROM operation_log WHERE status = ?',
      'processing',
    );
  });

  it('returns 0 for an empty status list', async () => {
    const rawDb = buildRawDb();

    await expect(countOperationLogBacklogRows(rawDb, [])).resolves.toBe(0);
  });
});

/** Builds a fixture `SQLiteDatabase` with sensible empty defaults, overridable per test. */
function buildRawDb(
  overrides: Partial<SQLiteDatabase> = {},
): SQLiteDatabase & {
  getAllAsync: jest.Mock<Promise<unknown[]>, [string, ...unknown[]]>;
  getFirstAsync: jest.Mock<Promise<OperationLogCountRow | null>, [string, ...unknown[]]>;
  runAsync: jest.Mock<Promise<{ changes: number }>, [string, ...unknown[]]>;
} {
  return {
    getAllAsync: jest.fn().mockResolvedValue([]),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    ...overrides,
  } as SQLiteDatabase & {
    getAllAsync: jest.Mock<Promise<unknown[]>, [string, ...unknown[]]>;
    getFirstAsync: jest.Mock<Promise<OperationLogCountRow | null>, [string, ...unknown[]]>;
    runAsync: jest.Mock<Promise<{ changes: number }>, [string, ...unknown[]]>;
  };
}
