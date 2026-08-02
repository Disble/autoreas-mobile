import type { SQLiteDatabase } from 'expo-sqlite';
import {
  DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS,
  SYNC_CYCLE_LOCK_ROW_ID,
} from './sync-cycle-lock.constants';
import type { WithExclusiveSyncCycleParams } from './sync-cycle-lock.types';

/**
 * Atomically claims the singleton cycle-lock row for one owner via a single conditional UPSERT.
 * The `WHERE` clause on `DO UPDATE` only lets the claim succeed when the existing lease already
 * expired or it is already held by the same owner (reentrant); any other case leaves the row
 * untouched and reports zero changes, so two different owners can never both claim it at once.
 */
async function claimSyncCycleLock(
  rawDb: SQLiteDatabase,
  owner: string,
  leaseMs: number,
  now: number,
): Promise<boolean> {
  const expiresAt = now + leaseMs;

  const result = await rawDb.runAsync(
    [
      'INSERT INTO sync_cycle_lock (id, owner, expires_at)',
      'VALUES (?, ?, ?)',
      'ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at',
      'WHERE sync_cycle_lock.expires_at <= ? OR sync_cycle_lock.owner = excluded.owner',
    ].join(' '),
    SYNC_CYCLE_LOCK_ROW_ID,
    owner,
    expiresAt,
    now,
  );

  return result.changes === 1;
}

async function releaseSyncCycleLock(rawDb: SQLiteDatabase, owner: string): Promise<void> {
  await rawDb.runAsync(
    'DELETE FROM sync_cycle_lock WHERE id = ? AND owner = ?',
    SYNC_CYCLE_LOCK_ROW_ID,
    owner,
  );
}

/**
 * Serializes reconcile cycles across separate SQLite connections (FGS tick vs WorkManager task).
 * When the lock is already held by another owner and has not expired, the later trigger is
 * absorbed as a no-op instead of running an overlapping reconcile write -- the in-flight cycle
 * already covers the same backlog, so skipping is safe. On lease expiry (e.g. the previous owner
 * crashed) a new owner reclaims the lock instead of deadlocking forever.
 */
export async function withExclusiveSyncCycle(
  params: WithExclusiveSyncCycleParams,
): Promise<void> {
  const {
    rawDb,
    owner,
    run,
    leaseMs = DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS,
    now = Date.now,
  } = params;

  const claimed = await claimSyncCycleLock(rawDb, owner, leaseMs, now());

  if (!claimed) {
    return;
  }

  try {
    await run();
  } finally {
    await releaseSyncCycleLock(rawDb, owner);
  }
}
