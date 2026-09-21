import type { SQLiteDatabase } from 'expo-sqlite';
import {
  runMigrations,
  withLocalWrite,
} from '../../../src/infrastructure/db/client/client.helpers';
import { SYNC_CYCLE_LOCK_ROW_ID } from '../../../src/features/sync/sync-cycle-lock.constants';
import { withExclusiveSyncCycle } from '../../../src/features/sync/sync-cycle-lock.helpers';
import {
  applyMigrationFiles,
  createTestSqliteAdapter,
} from '../../support/sqlite-adapter.helpers';

// The write door is mocked for the fake-store suites below but its REAL implementation is kept
// for the fence-contract suites, which drive a real node:sqlite adapter through the actual door.
/**
 * Real implementation of the write door captured before the module mock replaces it, so the
 * fence-contract suites can invoke it directly against the real node:sqlite adapter.
 */
const actualClientHelpers = jest.requireActual(
  '../../../src/infrastructure/db/client/client.helpers',
);

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  ...jest.requireActual('../../../src/infrastructure/db/client/client.helpers'),
  withLocalWrite: jest.fn(),
}));

// The ONLY production module mocked for the real-database suites: drizzle is handed a
// node:sqlite proxy handle instead of expo-sqlite, and the migrator is a no-op because
// `applyMigrationFiles` already ran the same SQL. `runMigrations` still executes its
// idempotent repair steps, which is where the `sync_cycle_lock.fence` column reaches
// databases created before the column existed.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => async () => undefined,
  getOpenDatabaseSync: () => () => undefined,
}));

/**
 * Minimal in-memory double of the `sync_cycle_lock` table shared by two independent connection
 * objects. It implements only the exact statement shapes `sync-cycle-lock.helpers.ts` issues
 * (CREATE TABLE IF NOT EXISTS / INSERT..ON CONFLICT..WHERE / DELETE), applying the same
 * conditional-upsert semantics real SQLite would -- this proves cross-connection serialization
 * without requiring a native SQLite binary in the Jest/Node environment.
 */
function createSharedLockStore() {
  let row: { owner: string; expiresAt: number; fence: string } | null = null;
  const statements: string[] = [];

  function createConnection(): SQLiteDatabase {
    return {
      async runAsync(sql: string, ...params: unknown[]) {
        statements.push(sql);
        if (sql.startsWith('CREATE TABLE')) {
          return { changes: 0, lastInsertRowId: 0 };
        }

        if (sql.startsWith('INSERT INTO sync_cycle_lock')) {
          const [, owner, expiresAt, fence, now] = params as [
            number,
            string,
            number,
            string,
            number,
          ];

          if (!row || row.expiresAt <= now || row.owner === owner) {
            row = { owner, expiresAt, fence };
            return { changes: 1, lastInsertRowId: 0 };
          }

          return { changes: 0, lastInsertRowId: 0 };
        }

        if (sql.startsWith('DELETE FROM sync_cycle_lock')) {
          const [, owner, fence] = params as [number, string, string];

          // Fenced release: the row is deleted only when BOTH the owner and the claim's own
          // fence token still match -- a reclaimed owner's release must affect zero rows.
          if (row && row.owner === owner && row.fence === fence) {
            row = null;
            return { changes: 1, lastInsertRowId: 0 };
          }

          return { changes: 0, lastInsertRowId: 0 };
        }

        throw new Error(`Unexpected SQL in fake lock store: ${sql}`);
      },
      async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
        statements.push(sql);
        if (sql.startsWith('SELECT owner, fence FROM sync_cycle_lock')) {
          const [id] = params as [number];

          if (row && id === 1) {
            return { owner: row.owner, fence: row.fence } as T;
          }

          return null;
        }

        throw new Error(`Unexpected SQL in fake lock store: ${sql}`);
      },
    } as unknown as SQLiteDatabase;
  }

  return { createConnection, statements };
}

describe('sync-cycle-lock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default passthrough matches the real (pre-E1) `withLocalWrite`: the task's `tx` is the
    // same connection the door was opened on, so the fake lock store's statement shapes below
    // stay valid without needing to mock the whole client.helpers/drizzle/migrations chain.
    (withLocalWrite as jest.Mock).mockImplementation(
      async (
        database: SQLiteDatabase,
        task: (db: unknown, tx: SQLiteDatabase) => Promise<unknown>,
      ) => task({}, database),
    );
  });

  it('uses the foreground-prepared lock table without issuing headless DDL', async () => {
    const store = createSharedLockStore();
    const rawDb = store.createConnection();

    await withExclusiveSyncCycle({
      rawDb,
      owner: 'headless_cycle',
      run: jest.fn().mockResolvedValue(undefined),
    });

    expect(store.statements).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^CREATE TABLE/)]),
    );
  });

  it('runs the guarded work when the lock is free and releases it afterward', async () => {
    const store = createSharedLockStore();
    const rawDb = store.createConnection();
    const run = jest.fn().mockResolvedValue(undefined);

    await withExclusiveSyncCycle({ rawDb, owner: 'foreground_service', run, now: () => 1_000 });

    expect(run).toHaveBeenCalledTimes(1);

    // The lock was released, so a second owner can claim it immediately afterward.
    const secondRun = jest.fn().mockResolvedValue(undefined);
    await withExclusiveSyncCycle({ rawDb, owner: 'headless_cycle', run: secondRun, now: () => 1_001 });

    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  it('serializes overlapping owners across separate connections to the same lock table', async () => {
    const store = createSharedLockStore();
    const fgsConnection = store.createConnection();
    const workManagerConnection = store.createConnection();

    const releaseFirstRunRef: { current: (() => void) | null } = { current: null };
    const firstRun = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseFirstRunRef.current = resolve;
        }),
    );
    const secondRun = jest.fn().mockResolvedValue(undefined);

    const firstCyclePromise = withExclusiveSyncCycle({
      rawDb: fgsConnection,
      owner: 'foreground_service',
      run: firstRun,
      now: () => 1_000,
    });

    // The WorkManager cycle fires while the FGS cycle is still in flight, on a separate connection.
    await withExclusiveSyncCycle({
      rawDb: workManagerConnection,
      owner: 'headless_cycle',
      run: secondRun,
      now: () => 1_500,
    });

    expect(secondRun).not.toHaveBeenCalled();

    releaseFirstRunRef.current?.();
    await firstCyclePromise;

    expect(firstRun).toHaveBeenCalledTimes(1);
  });

  it('reclaims an expired lock instead of skipping the guarded work forever', async () => {
    const store = createSharedLockStore();
    const rawDb = store.createConnection();
    const staleRun = jest.fn(() => new Promise<void>(() => undefined));

    void withExclusiveSyncCycle({
      rawDb,
      owner: 'foreground_service',
      run: staleRun,
      leaseMs: 1_000,
      now: () => 1_000,
    });

    await Promise.resolve();

    const reclaimingRun = jest.fn().mockResolvedValue(undefined);

    // Later than the stale owner's lease expiry (1_000 + 1_000 = 2_000).
    await withExclusiveSyncCycle({
      rawDb,
      owner: 'headless_cycle',
      run: reclaimingRun,
      now: () => 2_001,
    });

    expect(reclaimingRun).toHaveBeenCalledTimes(1);
  });

  it('is reentrant for the same owner and still releases on completion', async () => {
    const store = createSharedLockStore();
    const rawDb = store.createConnection();
    const run = jest.fn().mockResolvedValue(undefined);

    await withExclusiveSyncCycle({ rawDb, owner: 'foreground_service', run, now: () => 1_000 });
    await withExclusiveSyncCycle({ rawDb, owner: 'foreground_service', run, now: () => 1_001 });

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('releases the lock even when the guarded work throws', async () => {
    const store = createSharedLockStore();
    const rawDb = store.createConnection();
    const failingRun = jest.fn().mockRejectedValue(new Error('cycle failed'));

    await expect(
      withExclusiveSyncCycle({ rawDb, owner: 'foreground_service', run: failingRun, now: () => 1_000 }),
    ).rejects.toThrow('cycle failed');

    const nextRun = jest.fn().mockResolvedValue(undefined);
    await withExclusiveSyncCycle({ rawDb, owner: 'headless_cycle', run: nextRun, now: () => 1_001 });

    expect(nextRun).toHaveBeenCalledTimes(1);
  });

  it('routes claim and release through the write door, sequentially and never nested', async () => {
    const store = createSharedLockStore();
    const rawDb = store.createConnection();
    const order: string[] = [];

    (withLocalWrite as jest.Mock).mockImplementation(
      async (
        database: SQLiteDatabase,
        task: (db: unknown, tx: SQLiteDatabase) => Promise<unknown>,
      ) => {
        order.push('door:open');
        const result = await task({}, database);
        order.push('door:close');
        return result;
      },
    );
    const run = jest.fn(async () => {
      order.push('run:start');
      order.push('run:end');
    });

    await withExclusiveSyncCycle({ rawDb, owner: 'foreground_service', run, now: () => 1_000 });

    // claimSyncCycleLock:22 and releaseSyncCycleLock:39 are the seventh and eighth write doors
    // (design.md Cycle-lock routing). Sequential, not nested: the claim's door fully closes
    // before `run()` starts, and the release's door opens only after `run()` settles.
    expect(withLocalWrite).toHaveBeenCalledTimes(2);
    expect(order).toStrictEqual([
      'door:open',
      'door:close',
      'run:start',
      'run:end',
      'door:open',
      'door:close',
    ]);
  });

  it('does not let a throwing release replace `run()`\'s error', async () => {
    const store = createSharedLockStore();
    const rawDb = store.createConnection();
    const run = jest.fn().mockRejectedValue(new Error('cycle failed'));
    let doorCallCount = 0;

    (withLocalWrite as jest.Mock).mockImplementation(
      async (
        database: SQLiteDatabase,
        task: (db: unknown, tx: SQLiteDatabase) => Promise<unknown>,
      ) => {
        doorCallCount += 1;
        if (doorCallCount === 2) {
          // Simulates the release's own door failing (e.g. still SQLITE_BUSY after busy_timeout).
          throw new Error('release exploded');
        }
        return task({}, database);
      },
    );

    await expect(
      withExclusiveSyncCycle({ rawDb, owner: 'foreground_service', run, now: () => 1_000 }),
    ).rejects.toThrow('cycle failed');

    // Proves the assertion above actually exercised the release's door (and its throw), rather
    // than passing vacuously because release never routed through the door at all.
    expect(doorCallCount).toBe(2);
  });
});

describe('sync-cycle-lock fence contract (real node:sqlite database)', () => {
  /** Lets the write door's queued awaits settle without waiting on wall-clock timers. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  /** Opens one migrated, repaired adapter -- the schema shape an installed device has. */
  async function openAdapter(): Promise<SQLiteDatabase> {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    await runMigrations(adapter);

    return adapter;
  }

  /** Reads the singleton lease row back, or null once the row was released. */
  function readLockRow(rawDb: SQLiteDatabase) {
    return rawDb.getFirstAsync<{ owner: string; fence: string | null }>(
      'SELECT owner, fence FROM sync_cycle_lock WHERE id = ?',
      SYNC_CYCLE_LOCK_ROW_ID,
    );
  }

  beforeEach(() => {
    // The fence suites run the REAL write door over the real adapter.
    (withLocalWrite as jest.Mock).mockImplementation(actualClientHelpers.withLocalWrite);
  });

  it("a reclaimed lease rejects the previous owner's release", async () => {
    const rawDb = await openAdapter();

    let resolveFirstRun: () => void = () => undefined;
    const firstRun = jest.fn(
      () => new Promise<void>((resolve) => { resolveFirstRun = resolve; }),
    );
    const firstCycle = withExclusiveSyncCycle({
      rawDb,
      owner: 'first_owner',
      run: firstRun,
      leaseMs: 1_000,
      now: () => 1_000,
      generateFenceToken: () => 'fence-first',
    });
    while (firstRun.mock.calls.length === 0) {
      await flush();
    }

    // The first lease lapses (1_000 + 1_000 <= 2_500) and a second claimer takes the row
    // with its own fence token.
    let resolveSecondRun: () => void = () => undefined;
    const secondRun = jest.fn(
      () => new Promise<void>((resolve) => { resolveSecondRun = resolve; }),
    );
    const secondCycle = withExclusiveSyncCycle({
      rawDb,
      owner: 'second_owner',
      run: secondRun,
      leaseMs: 1_000,
      now: () => 2_500,
      generateFenceToken: () => 'fence-second',
    });
    while (secondRun.mock.calls.length === 0) {
      await flush();
    }

    await expect(readLockRow(rawDb)).resolves.toMatchObject({
      owner: 'second_owner',
      fence: 'fence-second',
    });

    // The FIRST claimer's release must affect zero rows: its fence no longer matches the row.
    resolveFirstRun();
    await firstCycle;

    await expect(readLockRow(rawDb)).resolves.toMatchObject({
      owner: 'second_owner',
      fence: 'fence-second',
    });

    // The CURRENT owner's release still deletes.
    resolveSecondRun();
    await secondCycle;

    await expect(readLockRow(rawDb)).resolves.toBeNull();
  });

  it("the current owner's release does delete the row (negative control)", async () => {
    const rawDb = await openAdapter();

    await withExclusiveSyncCycle({
      rawDb,
      owner: 'foreground_service',
      run: jest.fn().mockResolvedValue(undefined),
      now: () => 1_000,
      generateFenceToken: () => 'fence-a',
    });

    await expect(readLockRow(rawDb)).resolves.toBeNull();
  });
});
