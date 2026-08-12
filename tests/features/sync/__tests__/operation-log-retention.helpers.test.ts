import type { SQLiteDatabase } from 'expo-sqlite';
import { withDeferredWrite } from '../../../../src/infrastructure/db/client/client.helpers';
import {
  DEFAULT_OPERATION_LOG_RETENTION_POLICY,
  OPERATION_LOG_RETENTION_DAY_IN_MS,
} from '../../../../src/features/sync/operation-log-retention.constants';
import {
  countPendingOperationLog,
  pruneOperationLog,
  readOperationLogBacklog,
} from '../../../../src/features/sync/operation-log-retention.helpers';
import type { OperationLogCountRow } from '../../../../src/features/sync/operation-log-retention.types';

jest.mock('../../../../src/infrastructure/db/client/client.helpers', () => ({
  withDeferredWrite: jest.fn(),
}));

describe('operation log retention helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (withDeferredWrite as jest.Mock).mockImplementation(
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
    // Fixture is derived from the DEFAULT policy so this stays correct as the
    // policy's ttlDays/maxCount values evolve: overflow only fires strictly
    // above maxCount (`Math.max(0, currentCount - maxCount)`).
    const now = 1_000_000;
    const syncedCount = DEFAULT_OPERATION_LOG_RETENTION_POLICY.synced.maxCount + 1;
    const deadLetterCount = DEFAULT_OPERATION_LOG_RETENTION_POLICY.deadLetter.maxCount + 3;
    const syncedCutoff =
      now - DEFAULT_OPERATION_LOG_RETENTION_POLICY.synced.ttlDays * OPERATION_LOG_RETENTION_DAY_IN_MS;
    const deadLetterCutoff =
      now -
      DEFAULT_OPERATION_LOG_RETENTION_POLICY.deadLetter.ttlDays * OPERATION_LOG_RETENTION_DAY_IN_MS;

    const rawDb = buildRawDb({
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ count: syncedCount })
        .mockResolvedValueOnce({ count: deadLetterCount }),
      runAsync: jest
        .fn()
        .mockResolvedValueOnce({ changes: 2 })
        .mockResolvedValueOnce({ changes: 0 })
        .mockResolvedValueOnce({ changes: 1 })
        .mockResolvedValueOnce({ changes: 3 }),
    });

    const result = await pruneOperationLog(rawDb, {
      ...DEFAULT_OPERATION_LOG_RETENTION_POLICY,
      now: () => now,
    });

    // All four deletes must route through the file-keyed write door, not raw `rawDb.runAsync`
    // called outside it -- a write bypassing the door is a defect (local-write-serialization spec).
    expect(withDeferredWrite).toHaveBeenCalledWith(rawDb, expect.any(Function));

    expect(result).toEqual({
      prunedCount: 6,
      deletedSyncedCount: 3,
      deletedDeadLetterCount: 3,
    });
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE status = ? AND created_at < ?'),
      'synced',
      syncedCutoff,
    );
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE status = ? AND created_at < ?'),
      'dead_letter',
      deadLetterCutoff,
    );
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/ORDER BY created_at ASC, id ASC\s+LIMIT \?/),
      'synced',
      1,
    );
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      4,
      expect.stringMatching(/ORDER BY created_at ASC, id ASC\s+LIMIT \?/),
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
