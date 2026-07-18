import type { SQLiteDatabase } from 'expo-sqlite';
import {
  closeSyncRuntime,
  createSyncSQLiteRuntime,
} from '../../../../src/features/sync/sqlite-sync-runtime.helpers';
import type { CloseableSQLiteDatabase } from '../../../../src/features/sync/sqlite-sync-runtime.types';

describe('sqlite sync runtime helpers', () => {
  it('opens an isolated non-reactive connection, runs migrations once, and reuses it until close', async () => {
    const rawDb = buildRawDb();
    const openDatabase = jest.fn().mockReturnValue(rawDb);
    const runMigrations = jest.fn().mockResolvedValue(undefined);
    const runtime = createSyncSQLiteRuntime({
      owner: 'headless_cycle',
      openDatabase,
      runMigrations,
    });

    const openedDb = await runtime.open();
    const reusedDb = await runtime.withDatabase(async (currentDb) => currentDb);

    expect(openedDb).toBe(rawDb);
    expect(reusedDb).toBe(rawDb);
    expect(openDatabase).toHaveBeenCalledWith({
      enableChangeListener: false,
      useNewConnection: true,
    });
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(runtime.isOpen()).toBe(true);
  });

  it('closes idempotently and allows reopening with a fresh connection', async () => {
    const firstRawDb = buildRawDb();
    const secondRawDb = buildRawDb();
    const openDatabase = jest
      .fn()
      .mockReturnValueOnce(firstRawDb)
      .mockReturnValueOnce(secondRawDb);
    const runtime = createSyncSQLiteRuntime({
      owner: 'foreground_service',
      openDatabase,
      runMigrations: jest.fn().mockResolvedValue(undefined),
    });

    await runtime.open();
    await runtime.close();
    await runtime.close();
    const reopenedDb = await runtime.open();

    expect(firstRawDb.closeAsync).toHaveBeenCalledTimes(1);
    expect(secondRawDb.closeAsync).not.toHaveBeenCalled();
    expect(reopenedDb).toBe(secondRawDb);
    expect(openDatabase).toHaveBeenCalledTimes(2);
  });

  it('falls back to closeSync when async close fails', async () => {
    const rawDb = buildRawDb({
      closeAsync: jest.fn().mockRejectedValue(new Error('close failed')),
      closeSync: jest.fn(),
    });

    await closeSyncRuntime(rawDb);

    expect(rawDb.closeAsync).toHaveBeenCalledTimes(1);
    expect(rawDb.closeSync).toHaveBeenCalledTimes(1);
  });
});

function buildRawDb(
  overrides: Partial<CloseableSQLiteDatabase> = {},
): SQLiteDatabase & {
  closeAsync: jest.Mock<Promise<void>, []>;
  closeSync: jest.Mock<void, []>;
} {
  return {
    closeAsync: jest.fn().mockResolvedValue(undefined),
    closeSync: jest.fn(),
    ...overrides,
  } as SQLiteDatabase & {
    closeAsync: jest.Mock<Promise<void>, []>;
    closeSync: jest.Mock<void, []>;
  };
}
