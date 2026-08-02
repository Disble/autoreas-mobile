import type { SQLiteDatabase } from 'expo-sqlite';
import {
  closeSyncRuntime,
  createSyncSQLiteRuntime,
} from '../../../../src/features/sync/sqlite-sync-runtime.helpers';
import type { CloseableSQLiteDatabase } from '../../../../src/features/sync/sqlite-sync-runtime.types';
import { SchemaNotReadyError } from '../../../../src/infrastructure/db/startup';

describe('sqlite sync runtime helpers', () => {
  it('closes an isolated connection when durable schema readiness is absent', async () => {
    const rawDb = buildRawDb({
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest.fn().mockResolvedValue({ user_version: 0 }),
    });
    const openDatabase = jest.fn().mockReturnValue(rawDb);
    const runtime = createSyncSQLiteRuntime({
      owner: 'headless_cycle',
      openDatabase,
    });

    await expect(runtime.open()).rejects.toBeInstanceOf(SchemaNotReadyError);

    expect(openDatabase).toHaveBeenCalledWith({
      enableChangeListener: false,
      useNewConnection: true,
    });
    expect(rawDb.execAsync).toHaveBeenCalledWith('PRAGMA busy_timeout = 5000;');
    expect(rawDb.getFirstAsync).toHaveBeenCalledWith('PRAGMA user_version;');
    expect(rawDb.closeAsync).toHaveBeenCalledTimes(1);
    expect(runtime.isOpen()).toBe(false);
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
      prepareHeadlessDatabase: jest.fn().mockResolvedValue(undefined),
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

  it('does not retry corruption failures while opening an isolated connection', async () => {
    const corruption = new Error('SQLITE_CORRUPT: database disk image is malformed');
    const rawDb = buildRawDb({
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest.fn().mockRejectedValue(corruption),
    });
    const runtime = createSyncSQLiteRuntime({
      owner: 'headless_cycle',
      openDatabase: jest.fn().mockReturnValue(rawDb),
    });

    await expect(runtime.open()).rejects.toBe(corruption);
    expect(rawDb.getFirstAsync).toHaveBeenCalledTimes(1);
    expect(rawDb.closeAsync).toHaveBeenCalledTimes(1);
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
