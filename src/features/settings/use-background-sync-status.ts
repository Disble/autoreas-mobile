import { useMemo } from 'react';
import { createDrizzleDb } from '../../infrastructure/db/client';
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../infrastructure/db/native-runtime';
import { syncRuntimeStatus, type SyncRuntimeStatusRow } from '../../infrastructure/db/schema';
import {
  DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT,
  UNSUPPORTED_SYNC_RUNTIME_STATUS_SNAPSHOT,
} from '../sync/sync-runtime-status.constants';
import type { UseBackgroundSyncStatusResult } from './background-sync-status.types';

/** Coordinates background sync status state and actions. */
export function useBackgroundSyncStatus(): UseBackgroundSyncStatusResult {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();

  // 4. Queries/Mutations
  const db = useMemo(() => (rawDb ? createDrizzleDb(rawDb) : null), [rawDb]);
  const query = useMemo(() => {
    if (!db) {
      return null;
    }

    return db.select().from(syncRuntimeStatus).limit(1);
  }, [db]);
  const { data: snapshots } = useOptionalLiveQuery<SyncRuntimeStatusRow[]>(query, []);

  // 5. Derived State (`useMemo`)
  const snapshot = useMemo(() => {
    if (!rawDb) {
      return UNSUPPORTED_SYNC_RUNTIME_STATUS_SNAPSHOT;
    }

    const latestSnapshot = snapshots[0];

    if (!latestSnapshot) {
      return DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT;
    }

    return {
      registrationStatus: latestSnapshot.registrationStatus,
      executionMode: latestSnapshot.executionMode,
      isForegroundServiceRunning: latestSnapshot.isForegroundServiceRunning,
      canShowPersistentNotification: latestSnapshot.canShowPersistentNotification,
      lastAttemptAt: latestSnapshot.lastAttemptAt,
      lastSuccessAt: latestSnapshot.lastSuccessAt,
      lastFailureMessage: latestSnapshot.lastFailureMessage,
      lastTriggerSource: latestSnapshot.lastTriggerSource,
      lastSyncedCount: latestSnapshot.lastSyncedCount,
      isCycleActive: latestSnapshot.isCycleActive ?? false,
      lastBacklogReadCount: latestSnapshot.lastBacklogReadCount ?? 0,
      lastPrunedOperationsCount: latestSnapshot.lastPrunedOperationsCount ?? 0,
    };
  }, [rawDb, snapshots]);

  // 6. Callbacks (`useCallback` calling pure helpers)

  // 7. Effects

  return { snapshot };
}
