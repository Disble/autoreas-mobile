import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_OPERATION_LOG_RETENTION_POLICY } from '../operation-log-retention.constants';
import {
  countPendingOperationLog,
  pruneOperationLog,
  readOperationLogBacklog,
} from '../operation-log-retention.helpers';
import type { OperationLogCountRow } from '../operation-log-retention.types';

describe('operation log retention helpers', () => {
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

  it('prunes only terminal statuses using ttl first and max-count second', async () => {
    const rawDb = buildRawDb({
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ count: 1000 })
        .mockResolvedValueOnce({ count: 503 }),
      runAsync: jest
        .fn()
        .mockResolvedValueOnce({ changes: 2 })
        .mockResolvedValueOnce({ changes: 0 })
        .mockResolvedValueOnce({ changes: 0 })
        .mockResolvedValueOnce({ changes: 3 }),
    });

    const result = await pruneOperationLog(rawDb, {
      ...DEFAULT_OPERATION_LOG_RETENTION_POLICY,
      now: () => 1_000_000,
    });

    expect(result).toEqual({
      prunedCount: 5,
      deletedSyncedCount: 2,
      deletedDeadLetterCount: 3,
    });
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE status = ? AND created_at < ?'),
      'synced',
      395200,
    );
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE status = ? AND created_at < ?'),
      'dead_letter',
      -1592000,
    );
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('ORDER BY created_at ASC, id ASC LIMIT ?'),
      'dead_letter',
      3,
    );
  });
});

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
