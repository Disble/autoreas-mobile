import type { SQLiteDatabase } from 'expo-sqlite';
import {
  countOperationLogBacklogRows,
  readOperationLogBacklog,
} from '../../../../src/features/sync/operation-log-retention.helpers';
import type { OperationLogCountRow } from '../../../../src/features/sync/operation-log-retention.types';

describe('operation log backlog helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    await expect(countOperationLogBacklogRows(rawDb, ['pending'])).resolves.toBe(0);
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
