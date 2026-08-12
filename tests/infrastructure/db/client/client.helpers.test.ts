import type { SQLiteDatabase } from 'expo-sqlite';
import {
  applyConnectionPolicy,
  LocalWriteError,
  openAppDatabaseSync,
  toLocalWriteError,
  withLocalWrite,
} from '../../../../src/infrastructure/db/client/client.helpers';
import { getOpenDatabaseSync } from '../../../../src/infrastructure/db/native-runtime/native-runtime.helpers';

jest.mock('drizzle-orm', () => ({
  desc: jest.fn((value: unknown) => value),
}));

jest.mock('../../../../src/infrastructure/db/migrations/migrations', () => ({
  __esModule: true,
  default: { journal: { entries: [] }, migrations: {} },
}));

jest.mock('../../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: jest.fn(() => () => ({})),
  getDrizzleMigrator: jest.fn(),
  getOpenDatabaseSync: jest.fn(),
}));

/**
 * These tests characterise the write-failure diagnostics the field report needs: the toast has
 * always read byte-identical text regardless of root cause, so distinct SQLite failures were
 * indistinguishable without a real device. `toLocalWriteError` is the instrument that makes them
 * distinguishable through telemetry without touching that copy.
 */
describe('toLocalWriteError', () => {
  it('parses the primary errcode from the Android control-byte error shape', () => {
    const controlByte = String.fromCharCode(5);
    const cause = new Error(
      `Call to function 'NativeStatement.runSync' has been rejected.\n-> Caused by: Error code ${controlByte}: database is locked`,
    );

    const error = toLocalWriteError(cause, Date.now(), 'task');

    expect(error.errcode).toBe(5);
  });

  it('degrades to a null errcode when the message shape is unparseable', () => {
    const cause = new Error('database is locked');

    const error = toLocalWriteError(cause, Date.now(), 'task');

    expect(error.errcode).toBeNull();
  });

  it('degrades to a null errcode on the iOS decimal error shape instead of misreading a digit as a control byte', () => {
    // iOS's `convertSqlLiteErrorToString` (SQLiteModule.swift:479) renders the code as a decimal
    // string ("Error code 5: ..."), not a raw byte the way Android's binding does
    // (NativeDatabaseBinding.cpp:194-202). A digit-shaped capture is deliberately treated as
    // unparseable so a single-digit iOS code is never misread as an Android control byte.
    const cause = new Error('Error code 5: database is locked');

    const error = toLocalWriteError(cause, Date.now(), 'task');

    expect(error.errcode).toBeNull();
  });

  it('captures elapsedMs and stage independently of whether the errcode was determined', () => {
    const startedAt = Date.now() - 250;

    const error = toLocalWriteError(new Error('database is locked'), startedAt, 'commit');

    expect(error.errcode).toBeNull();
    expect(error.elapsedMs).toBeGreaterThanOrEqual(250);
    expect(error.stage).toBe('commit');
  });

  it('copies the message verbatim from the cause', () => {
    const controlByte = String.fromCharCode(5);
    const cause = new Error(`Error code ${controlByte}: database is locked`);

    const error = toLocalWriteError(cause, Date.now(), 'begin');

    expect(error.message).toBe(cause.message);
  });

  it.each(['begin', 'task', 'commit', 'rollback'] as const)(
    'accepts %s as a stage value',
    (stage) => {
      const error = toLocalWriteError(new Error('boom'), Date.now(), stage);

      expect(error.stage).toBe(stage);
    },
  );

  it('produces a LocalWriteError instance', () => {
    const error = toLocalWriteError(new Error('boom'), Date.now(), 'begin');

    expect(error).toBeInstanceOf(LocalWriteError);
  });
});

/**
 * `BEGIN` sits OUTSIDE the rollback guard by design (design.md Statement Order): expo's own
 * `withTransactionAsync` rolls back a transaction that never began and masks the real error, so
 * `withLocalWrite` issues its own `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` via `execAsync` instead
 * of delegating to it. The busy wait must land on expo's native thread before any synchronous
 * drizzle statement runs (H2).
 */
describe('withLocalWrite transaction order', () => {
  it('issues BEGIN IMMEDIATE, then the task, then COMMIT, in that order', async () => {
    const order: string[] = [];
    const rawDb = {
      execAsync: jest.fn(async (sql: string) => {
        order.push(sql);
      }),
    } as unknown as SQLiteDatabase;

    await withLocalWrite(rawDb, async () => {
      order.push('task');
    });

    expect(order).toStrictEqual(['BEGIN IMMEDIATE', 'task', 'COMMIT']);
  });

  it('issues exactly one ROLLBACK when the task throws', async () => {
    const rawDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
    } as unknown as SQLiteDatabase;

    await expect(
      withLocalWrite(rawDb, async () => {
        throw new Error('database is locked');
      }),
    ).rejects.toThrow('database is locked');

    expect(rawDb.execAsync).toHaveBeenCalledTimes(2);
    expect(rawDb.execAsync).toHaveBeenNthCalledWith(1, 'BEGIN IMMEDIATE');
    expect(rawDb.execAsync).toHaveBeenNthCalledWith(2, 'ROLLBACK');
  });

  it('issues no ROLLBACK when BEGIN itself fails', async () => {
    const rawDb = {
      execAsync: jest.fn().mockRejectedValue(new Error('database is locked')),
    } as unknown as SQLiteDatabase;
    const task = jest.fn();

    await expect(withLocalWrite(rawDb, task)).rejects.toMatchObject({ stage: 'begin' });

    expect(task).not.toHaveBeenCalled();
    expect(rawDb.execAsync).toHaveBeenCalledTimes(1);
    expect(rawDb.execAsync).toHaveBeenCalledWith('BEGIN IMMEDIATE');
  });

  it('does not let a failing ROLLBACK mask the original task error', async () => {
    const rawDb = {
      execAsync: jest.fn((sql: string) => {
        if (sql === 'ROLLBACK') return Promise.reject(new Error('rollback exploded'));
        return Promise.resolve(undefined);
      }),
    } as unknown as SQLiteDatabase;

    await expect(
      withLocalWrite(rawDb, async () => {
        throw new Error('original task failure');
      }),
    ).rejects.toMatchObject({ message: 'original task failure' });
  });
});

describe('withLocalWrite failure diagnostics', () => {
  it('reports stage "begin" when the failure happens before the task ever starts', async () => {
    const task = jest.fn();
    const rawDb = {
      execAsync: jest.fn().mockRejectedValue(new Error('database is locked')),
    } as unknown as SQLiteDatabase;

    await expect(withLocalWrite(rawDb, task)).rejects.toMatchObject({ stage: 'begin' });
    expect(task).not.toHaveBeenCalled();
  });

  it('reports stage "task" when the failure happens inside the task callback', async () => {
    const rawDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
    } as unknown as SQLiteDatabase;

    await expect(
      withLocalWrite(rawDb, async () => {
        throw new Error('database is locked');
      }),
    ).rejects.toMatchObject({ stage: 'task' });
  });

  it('reports stage "commit" when the task resolves but COMMIT still rejects', async () => {
    const rawDb = {
      execAsync: jest.fn((sql: string) => {
        if (sql === 'COMMIT') return Promise.reject(new Error('database is locked'));
        return Promise.resolve(undefined);
      }),
    } as unknown as SQLiteDatabase;

    await expect(withLocalWrite(rawDb, async () => undefined)).rejects.toMatchObject({
      stage: 'commit',
    });
  });

  it('wraps the failure as a LocalWriteError so diagnostics travel with the rejection', async () => {
    const rawDb = {
      execAsync: jest.fn().mockRejectedValue(new Error('database is locked')),
    } as unknown as SQLiteDatabase;

    await expect(withLocalWrite(rawDb, jest.fn())).rejects.toBeInstanceOf(LocalWriteError);
  });
});

describe('applyConnectionPolicy', () => {
  it('issues PRAGMA busy_timeout synchronously so no connection can skip it', () => {
    const rawDb = { execSync: jest.fn() } as unknown as SQLiteDatabase;

    applyConnectionPolicy(rawDb);

    expect(rawDb.execSync).toHaveBeenCalledWith('PRAGMA busy_timeout = 5000;');
  });
});

describe('openAppDatabaseSync connection policy', () => {
  it('issues PRAGMA busy_timeout before returning the handle', () => {
    const events: string[] = [];
    const rawDb = {
      execSync: jest.fn((statement: string) => {
        events.push(statement);
      }),
    } as unknown as SQLiteDatabase;
    (getOpenDatabaseSync as jest.Mock).mockReturnValue(
      jest.fn(() => {
        events.push('opened');
        return rawDb;
      }),
    );

    const returnedDb = openAppDatabaseSync();

    expect(events).toEqual(['opened', 'PRAGMA busy_timeout = 5000;']);
    expect(returnedDb).toBe(rawDb);
  });
});
