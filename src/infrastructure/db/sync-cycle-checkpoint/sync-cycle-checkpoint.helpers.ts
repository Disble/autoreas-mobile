import type { SQLiteDatabase } from 'expo-sqlite';
import { openTelemetryDatabaseSync } from '../client/client.helpers';
import {
  SYNC_CYCLE_CHECKPOINT_BUSY_TIMEOUT_MS,
  SYNC_CYCLE_CHECKPOINT_DATABASE_NAME,
  SYNC_CYCLE_CHECKPOINT_SELECT_SQL,
  SYNC_CYCLE_CHECKPOINT_TABLE_SQL,
  SYNC_CYCLE_CHECKPOINT_UPSERT_SQL,
} from './sync-cycle-checkpoint.constants';
import type {
  SyncCycleCheckpointRow,
  SyncCycleCheckpointSnapshot,
  SyncCycleCheckpointStore,
  SyncCycleCheckpointStoreParams,
} from './sync-cycle-checkpoint.types';

/**
 * Builds the snapshot a later cycle reports from, or `null` when the row is unusable.
 *
 * `stage` is deliberately NOT validated here. This layer stores an opaque checkpoint label; the
 * feature layer owns the closed set (`SYNC_CYCLE_STAGES`) and re-validates on read, which is also
 * why infrastructure never imports that type. Returning the raw value keeps a stage name written
 * by a newer build readable by an older reader instead of erasing it.
 */
function toCheckpointSnapshot(
  row: SyncCycleCheckpointRow | null,
): SyncCycleCheckpointSnapshot | null {
  if (!row) {
    return null;
  }

  return {
    cycleId: row.cycle_id,
    stage: row.stage,
    stageAt: row.stage_at,
    startedAt: row.started_at,
    failedCheckpointCount: row.failed_checkpoint_count,
    elapsedMs: row.stage_at - row.started_at,
  };
}

/**
 * Creates the checkpoint store for one cycle.
 *
 * Every write is SYNCHRONOUS (`runSync`), which is the opposite of this codebase's usual rule and
 * is the point. The environment this instrument has to survive is one where JS timers are paused
 * and the shared write queue is jammed, so anything routed through a promise, a queue or a timer
 * can silently never complete. A synchronous statement on a private file bounded natively by
 * `busy_timeout` depends on none of that, and it makes the failure count exact rather than a guess
 * about promises that may never settle.
 */
export function createSyncCycleCheckpointStore(
  params: SyncCycleCheckpointStoreParams,
): SyncCycleCheckpointStore {
  const openDatabase = params.openDatabase ?? openTelemetryDatabaseSync;
  const now = params.now ?? Date.now;
  let rawDb: SQLiteDatabase | null = null;
  let failedCheckpointCount = 0;

  function connect(): SQLiteDatabase {
    if (rawDb) {
      return rawDb;
    }

    const opened = openDatabase({
      databaseName: SYNC_CYCLE_CHECKPOINT_DATABASE_NAME,
      useNewConnection: true,
      enableChangeListener: false,
      busyTimeoutMs: SYNC_CYCLE_CHECKPOINT_BUSY_TIMEOUT_MS,
    });

    opened.execSync(SYNC_CYCLE_CHECKPOINT_TABLE_SQL);
    rawDb = opened;

    return opened;
  }

  function record(stage: string): void {
    try {
      connect().runSync(
        SYNC_CYCLE_CHECKPOINT_UPSERT_SQL,
        params.cycleId,
        stage,
        now(),
        params.startedAt,
        failedCheckpointCount,
      );
    } catch {
      // Swallowed by contract: instrumentation must never be the reason a cycle fails. The count
      // is what keeps the silence honest -- a stale stage read with a non-zero count is known to
      // be degraded rather than trusted as the place the cycle died.
      failedCheckpointCount += 1;
    }
  }

  async function readLastCheckpoint(): Promise<SyncCycleCheckpointSnapshot | null> {
    try {
      const row = await connect().getFirstAsync<SyncCycleCheckpointRow>(
        SYNC_CYCLE_CHECKPOINT_SELECT_SQL,
      );

      return toCheckpointSnapshot(row);
    } catch {
      return null;
    }
  }

  return {
    record,
    getFailedCheckpointCount: () => failedCheckpointCount,
    readLastCheckpoint,
  };
}
