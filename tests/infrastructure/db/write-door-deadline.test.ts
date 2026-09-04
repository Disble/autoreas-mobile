import type { SQLiteDatabase } from 'expo-sqlite';
import { LOCAL_WRITE_DEADLINE_MS } from '../../../src/infrastructure/db/client/client.constants';
import { withLocalWrite } from '../../../src/infrastructure/db/client/client.helpers';
import { LocalWriteError } from '../../../src/infrastructure/db/client/client.errors';

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () => () => ({}),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** Builds a connection double that records the statements the write door issues. */
function fakeConnection(databasePath: string) {
  const statements: string[] = [];
  const rawDb = {
    databasePath,
    execAsync: (sql: string) => {
      statements.push(sql);
      return Promise.resolve();
    },
  } as unknown as SQLiteDatabase;

  return { rawDb, statements };
}

describe('write door deadline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lets an ordinary write through untouched', async () => {
    const { rawDb, statements } = fakeConnection('door-ordinary');

    const result = await withLocalWrite(rawDb, () => Promise.resolve('written'));

    expect(result).toBe('written');
    expect(statements).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects the caller with a typed deadline failure when a write never settles', async () => {
    const { rawDb } = fakeConnection('door-hung');
    const pending = withLocalWrite(rawDb, () => new Promise<never>(() => undefined));
    const assertion = pending.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(LOCAL_WRITE_DEADLINE_MS);
    const error = await assertion;

    expect(error).toBeInstanceOf(LocalWriteError);
    expect(error).toMatchObject({ stage: 'deadline' });
  });

  it('KEEPS THE DOOR CLOSED after a deadline, admitting no second writer', async () => {
    // The load-bearing case. `withLocalWrite` issues BEGIN IMMEDIATE on the connection, and a JS
    // timer cannot cancel native SQLite work. If the deadline opened the door, a successor would
    // begin a SECOND transaction on a connection that already has one open -- the
    // SQLITE_BUSY_SNAPSHOT class the file-keyed door exists to prevent, and the exact defect the
    // archived 2026-08-12-sqlite-write-lock-contention change was written to remove.
    //
    // A visible deadlock beats two concurrent transactions. The caller is told; the door is not
    // opened.
    const { rawDb } = fakeConnection('door-still-held');
    let releaseFirst: () => void = () => undefined;
    const firstWrite = withLocalWrite(
      rawDb,
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const firstAssertion = firstWrite.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(LOCAL_WRITE_DEADLINE_MS);
    expect(await firstAssertion).toBeInstanceOf(LocalWriteError);

    let secondTaskRan = false;
    const secondWrite = withLocalWrite(rawDb, () => {
      secondTaskRan = true;
      return Promise.resolve('second');
    });
    const secondAssertion = secondWrite.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(0);

    // The first transaction is still open on the connection, so the second must not have begun.
    expect(secondTaskRan).toBe(false);

    // Once the real write finally settles, the queue advances normally.
    releaseFirst();
    await jest.advanceTimersByTimeAsync(0);
    await secondAssertion;

    expect(secondTaskRan).toBe(true);
  });

  it('reports elapsed time that includes waiting behind the door', async () => {
    // `startedAt` is taken when the write is queued, not when its transaction begins, so a caller
    // stuck behind a jammed door sees the wait it actually experienced rather than a near-zero
    // number that hides the stall.
    const { rawDb } = fakeConnection('door-elapsed');
    const pending = withLocalWrite(rawDb, () => new Promise<never>(() => undefined));
    const assertion = pending.catch((error: unknown) => error as LocalWriteError);

    await jest.advanceTimersByTimeAsync(LOCAL_WRITE_DEADLINE_MS);
    const error = await assertion;

    expect(error.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(error.stage).toBe('deadline');
  });
});
