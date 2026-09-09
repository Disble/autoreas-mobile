import type { SQLiteDatabase } from 'expo-sqlite';
import { openTelemetryDatabaseSync } from '../client/client.helpers';
import { SYNC_CYCLE_CHECKPOINT_DATABASE_NAME } from '../sync-cycle-checkpoint/sync-cycle-checkpoint.constants';
import {
  SYNC_DIAGNOSTICS_OUTBOX_BUSY_TIMEOUT_MS,
  SYNC_DIAGNOSTICS_OUTBOX_EVICT_TRIGGER_SQL,
  SYNC_DIAGNOSTICS_OUTBOX_INSERT_SQL,
  SYNC_DIAGNOSTICS_OUTBOX_REMOVE_SQL,
  SYNC_DIAGNOSTICS_OUTBOX_SELECT_CANDIDATES_SQL,
  SYNC_DIAGNOSTICS_OUTBOX_STATE_TABLE_SQL,
  SYNC_DIAGNOSTICS_OUTBOX_STATE_UPSERT_SQL,
  SYNC_DIAGNOSTICS_OUTBOX_TABLE_SQL,
} from './sync-diagnostics-outbox.constants';
import type {
  SyncDiagnosticsOutboxEntry,
  SyncDiagnosticsOutboxRecord,
  SyncDiagnosticsOutboxRow,
  SyncDiagnosticsOutboxStore,
  SyncDiagnosticsOutboxStoreParams,
  SyncDiagnosticsOutboxWriteOutcome,
} from './sync-diagnostics-outbox.types';

/** Maps a raw SQLite row onto the record shape the flush algorithm consumes. */
function toRecord(row: SyncDiagnosticsOutboxRow): SyncDiagnosticsOutboxRecord {
  return {
    cycleId: row.cycle_id,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

/**
 * Creates the diagnostics outbox store. Shares its SQLite FILE with the cycle checkpoint
 * (`autoreas-telemetry.db`) but opens its OWN private connection, exactly like the checkpoint
 * store, so a caller here can never accidentally reuse a handle another instrument owns.
 *
 * Every read and write is SYNCHRONOUS (`runSync`/`getAllSync`), deviating from the checkpoint's
 * `getFirstAsync` on the same argument its own constants file makes: `busy_timeout`, enforced
 * natively inside SQLite, is the only bound that fires in a runtime where JS timers are paused.
 * `withLocalWrite` is rejected outright -- that is the failure domain this store exists to escape.
 */
export function createSyncDiagnosticsOutboxStore(
  params: SyncDiagnosticsOutboxStoreParams = {},
): SyncDiagnosticsOutboxStore {
  const openDatabase = params.openDatabase ?? openTelemetryDatabaseSync;
  const now = params.now ?? Date.now;
  let rawDb: SQLiteDatabase | null = null;
  let failedWriteCount = 0;

  function connect(): SQLiteDatabase {
    if (rawDb) {
      return rawDb;
    }

    const opened = openDatabase({
      databaseName: SYNC_CYCLE_CHECKPOINT_DATABASE_NAME,
      useNewConnection: true,
      enableChangeListener: false,
      busyTimeoutMs: SYNC_DIAGNOSTICS_OUTBOX_BUSY_TIMEOUT_MS,
    });

    opened.execSync(SYNC_DIAGNOSTICS_OUTBOX_TABLE_SQL);
    opened.execSync(SYNC_DIAGNOSTICS_OUTBOX_STATE_TABLE_SQL);
    opened.execSync(SYNC_DIAGNOSTICS_OUTBOX_EVICT_TRIGGER_SQL);
    rawDb = opened;

    return opened;
  }

  function enqueue(entry: SyncDiagnosticsOutboxEntry): void {
    try {
      connect().runSync(
        SYNC_DIAGNOSTICS_OUTBOX_INSERT_SQL,
        entry.cycleId,
        entry.payload,
        now(),
      );
    } catch {
      // Swallowed by contract: instrumentation must never be the reason a cycle fails.
      failedWriteCount += 1;
    }
  }

  function readFlushCandidates(
    limit: number,
    atTime: number,
  ): readonly SyncDiagnosticsOutboxRecord[] {
    try {
      const rows = connect().getAllSync<SyncDiagnosticsOutboxRow>(
        SYNC_DIAGNOSTICS_OUTBOX_SELECT_CANDIDATES_SQL,
        atTime,
        limit,
      );

      return rows.map(toRecord);
    } catch {
      return [];
    }
  }

  function remove(cycleId: string): SyncDiagnosticsOutboxWriteOutcome {
    try {
      connect().runSync(SYNC_DIAGNOSTICS_OUTBOX_REMOVE_SQL, cycleId);

      return 'removed';
    } catch {
      failedWriteCount += 1;

      return 'failed';
    }
  }

  function deferUntil(notBefore: number): void {
    try {
      connect().runSync(SYNC_DIAGNOSTICS_OUTBOX_STATE_UPSERT_SQL, notBefore);
    } catch {
      failedWriteCount += 1;
    }
  }

  return {
    enqueue,
    readFlushCandidates,
    remove,
    deferUntil,
    getFailedWriteCount: () => failedWriteCount,
  };
}
