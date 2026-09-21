import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import {
  CLAIM_SYNC_CYCLE_LOCK_SQL,
  DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS,
  READ_SYNC_CYCLE_LOCK_OWNERSHIP_SQL,
  RELEASE_SYNC_CYCLE_LOCK_SQL,
  SYNC_CYCLE_LOCK_ROW_ID,
} from './sync-cycle-lock.constants';
import type { WithExclusiveSyncCycleParams } from './sync-cycle-lock.types';

/** Shape of the ownership read-back row: `fence` is null on rows claimed pre-fencing. */
interface SyncCycleLockOwnershipRow {
  readonly owner: string;
  readonly fence: string | null;
}

/**
 * Atomically claims the singleton cycle-lock row for one owner via a single conditional UPSERT,
 * stamping a UNIQUE PER-CLAIM fence token on the row in the same statement. The `WHERE` clause
 * on `DO UPDATE` only lets the claim succeed when the existing lease already expired or it is
 * already held by the same owner (reentrant); any other case leaves the row untouched, so two
 * different owners can never both claim it at once.
 *
 * The claim is VERIFIED by reading the row's `owner` and `fence` back inside the same write-door
 * task rather than by trusting the affected-rows count: the stored pair is the single source of
 * truth for who holds the lease, and only a read-back proving BOTH values match this claim makes
 * the returned token authoritative for the fence-scoped release below.
 *
 * The fence is what makes a RECLAIMED lease reject the previous owner's writes (ADR 008): once a
 * later claimant overwrites `fence`, the stale owner's release affects zero rows and the row
 * keeps belonging to the current holder. Without it, a lease lapse would only prevent new claims
 * while the previous owner could still delete whatever row is current.
 *
 * Routed through the write door -- the seventh door (design.md Cycle-lock routing). This
 * primitive serialises cycles across separate connections *and across JS runtimes*, exactly
 * where the JS-level write queue alone cannot reach; unrouted, a contended claim throws
 * `SQLITE_BUSY` instead of waiting.
 */
async function claimSyncCycleLock(
  rawDb: SQLiteDatabase,
  owner: string,
  leaseMs: number,
  now: number,
  generateFenceToken: () => string,
): Promise<string | null> {
  const fenceToken = generateFenceToken();
  const expiresAt = now + leaseMs;

  return withLocalWrite(rawDb, async (_db, tx) => {
    await tx.runAsync(
      CLAIM_SYNC_CYCLE_LOCK_SQL,
      SYNC_CYCLE_LOCK_ROW_ID,
      owner,
      expiresAt,
      fenceToken,
      now,
    );

    const row = await tx.getFirstAsync<SyncCycleLockOwnershipRow>(
      READ_SYNC_CYCLE_LOCK_OWNERSHIP_SQL,
      SYNC_CYCLE_LOCK_ROW_ID,
    );

    return row !== null && row.owner === owner && row.fence === fenceToken
      ? fenceToken
      : null;
  });
}

/**
 * Releases the lease by deleting ONLY the row this claim still owns: both the owner and the
 * claim's own fence token must match. After a reclaim, the previous owner's fence no longer
 * matches and this affects zero rows -- the stale owner cannot delete the current holder's row.
 *
 * Routed through the write door -- the eighth door. See `claimSyncCycleLock` above.
 */
async function releaseSyncCycleLock(
  rawDb: SQLiteDatabase,
  owner: string,
  fenceToken: string,
): Promise<void> {
  await withLocalWrite(rawDb, async (_db, tx) =>
    tx.runAsync(
      RELEASE_SYNC_CYCLE_LOCK_SQL,
      SYNC_CYCLE_LOCK_ROW_ID,
      owner,
      fenceToken,
    ),
  );
}

/**
 * Serializes reconcile cycles across separate SQLite connections (FGS tick vs WorkManager task).
 * When the lock is already held by another owner and has not expired, the later trigger is
 * absorbed as a no-op instead of running an overlapping reconcile write -- the in-flight cycle
 * already covers the same backlog, so skipping is safe. On lease expiry (e.g. the previous owner
 * crashed) a new owner reclaims the lock instead of deadlocking forever, and the reclaim
 * overwrites the fence so the previous owner's release becomes a no-op.
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
    generateFenceToken = Crypto.randomUUID,
  } = params;

  const fenceToken = await claimSyncCycleLock(rawDb, owner, leaseMs, now(), generateFenceToken);

  if (fenceToken === null) {
    return;
  }

  try {
    await run();
  } finally {
    try {
      await releaseSyncCycleLock(rawDb, owner, fenceToken);
    } catch {
      // A release failure must never replace `run()`'s outcome -- a bare `finally` throw would
      // otherwise mask it (same masking rule as decisions 2 and 6). The lease's own expiry is
      // already the designed backstop when release itself cannot complete, and a reclaimed
      // release is a zero-row no-op by construction.
    }
  }
}
