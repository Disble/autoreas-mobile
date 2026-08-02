import type { SQLiteDatabase } from 'expo-sqlite';
import {
  prepareForegroundDatabase,
  prepareHeadlessDatabase,
  SchemaIncompatibleError,
  SchemaValidationError,
} from '../../../src/infrastructure/db/startup';
import { runMigrations } from '../../../src/infrastructure/db/client/client.helpers';

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  runMigrations: jest.fn(),
}));

describe('database startup helpers', () => {
  it('writes durable readiness only after policy, migrations, and schema validation succeed', async () => {
    const events: string[] = [];
    const rawDb = {
      execAsync: jest.fn(async (statement: string) => {
        events.push(statement);
      }),
      getFirstAsync: jest
        .fn()
        .mockImplementationOnce(async () => {
          events.push('readiness-check');
          return { user_version: 0 };
        })
        .mockImplementationOnce(async () => {
          events.push('quick-check');
          return { quick_check: 'ok' };
        })
        .mockImplementationOnce(async () => {
          events.push('table-check');
          return { count: 8 };
        }),
    } as unknown as SQLiteDatabase;
    (runMigrations as jest.Mock).mockImplementationOnce(async () => {
      events.push('migrations');
    });

    await prepareForegroundDatabase(rawDb);

    expect(events).toEqual([
      'PRAGMA busy_timeout = 5000;',
      'PRAGMA journal_mode = WAL;',
      'readiness-check',
      'migrations',
      'quick-check',
      'table-check',
      'PRAGMA user_version = 1;',
    ]);
  });

  it('never writes readiness when schema validation fails', async () => {
    const rawDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ user_version: 0 })
        .mockResolvedValueOnce({ quick_check: 'database disk image is malformed' })
        .mockResolvedValueOnce({ count: 8 }),
    } as unknown as SQLiteDatabase;
    (runMigrations as jest.Mock).mockResolvedValueOnce(undefined);

    await expect(prepareForegroundDatabase(rawDb)).rejects.toBeInstanceOf(
      SchemaValidationError,
    );
    expect(rawDb.execAsync).not.toHaveBeenCalledWith('PRAGMA user_version = 1;');
  });

  it('skips schema writes when the exact readiness version is already durable', async () => {
    const rawDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ user_version: 1 })
        .mockResolvedValueOnce({ quick_check: 'ok' })
        .mockResolvedValueOnce({ count: 8 }),
    } as unknown as SQLiteDatabase;
    (runMigrations as jest.Mock).mockClear();

    await prepareForegroundDatabase(rawDb);

    expect(runMigrations).not.toHaveBeenCalled();
    expect(rawDb.execAsync).not.toHaveBeenCalledWith('PRAGMA user_version = 1;');
  });

  it('permits headless access only for the exact durable readiness version', async () => {
    const readyDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest.fn().mockResolvedValue({ user_version: 1 }),
    } as unknown as SQLiteDatabase;
    const newerDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest.fn().mockResolvedValue({ user_version: 2 }),
    } as unknown as SQLiteDatabase;

    await expect(prepareHeadlessDatabase(readyDb)).resolves.toBeUndefined();
    await expect(prepareHeadlessDatabase(newerDb)).rejects.toBeInstanceOf(
      SchemaIncompatibleError,
    );
  });
});
