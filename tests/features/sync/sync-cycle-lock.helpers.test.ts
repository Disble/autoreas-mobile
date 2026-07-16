import type { SQLiteDatabase } from 'expo-sqlite';
import { withExclusiveSyncCycle } from '../../../src/features/sync/sync-cycle-lock.helpers';

/**
 * Minimal in-memory double of the `sync_cycle_lock` table shared by two independent connection
 * objects. It implements only the exact statement shapes `sync-cycle-lock.helpers.ts` issues
 * (CREATE TABLE IF NOT EXISTS / INSERT..ON CONFLICT..WHERE / DELETE), applying the same
 * conditional-upsert semantics real SQLite would -- this proves cross-connection serialization
 * without requiring a native SQLite binary in the Jest/Node environment.
 */
function createSharedLockStore() {
  let row: { owner: string; expiresAt: number } | null = null;

  function createConnection(): SQLiteDatabase {
    return {
      async runAsync(sql: string, ...params: unknown[]) {
        if (sql.startsWith('CREATE TABLE')) {
          return { changes: 0, lastInsertRowId: 0 };
        }

        if (sql.startsWith('INSERT INTO sync_cycle_lock')) {
          const [, owner, expiresAt, now] = params as [number, string, number, number];

          if (!row || row.expiresAt <= now || row.owner === owner) {
            row = { owner, expiresAt };
            return { changes: 1, lastInsertRowId: 0 };
          }

          return { changes: 0, lastInsertRowId: 0 };
        }

        if (sql.startsWith('DELETE FROM sync_cycle_lock')) {
          const [, owner] = params as [number, string];

          if (row && row.owner === owner) {
            row = null;
            return { changes: 1, lastInsertRowId: 0 };
          }

          return { changes: 0, lastInsertRowId: 0 };
        }

        throw new Error(`Unexpected SQL in fake lock store: ${sql}`);
      },
    } as unknown as SQLiteDatabase;
  }

  return { createConnection };
}

describe('sync-cycle-lock', () => {
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
});
