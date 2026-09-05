import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useOptionalLiveQuery, useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime/native-runtime.helpers';
import { useActiveSeasonStore } from '../../infrastructure/store/active-season-store';
import { useBridgeConfig } from '../settings/use-bridge-config';
import {
  buildPendingOperationsQuery,
  buildUnresolvedSeasonRatingQuery,
  resolveSyncPrerequisites,
  runCoordinatedForegroundSyncCycle,
} from './sync-facade.helpers';
import type { UseSyncFacadeResult } from './sync-facade.types';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';
import {
  getSyncConnectionSnapshot,
  invalidateSyncConnectionOnline,
  runSharedForegroundSyncCycle,
  subscribeSyncConnection,
} from './sync-connection-store/sync-connection-store.helpers';

/** Coordinates sync facade state and actions. */
export function useSyncFacade(): UseSyncFacadeResult {
  // 1. Refs
  // 2. State
  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  const { configStatus, isConfigured } = useBridgeConfig();
  const setActiveSeasonSnapshot = useActiveSeasonStore((state) => state.setActiveSeasonSnapshot);
  const syncConnection = useSyncExternalStore(
    subscribeSyncConnection,
    getSyncConnectionSnapshot,
    getSyncConnectionSnapshot,
  );

  // 4. Queries/Mutations
  const pendingOperationsQuery = useMemo(
    () => (rawDb ? buildPendingOperationsQuery(rawDb) : null),
    [rawDb],
  );
  const { data: pendingOperationRows } = useOptionalLiveQuery(
    pendingOperationsQuery,
    [] as { id: number }[],
  );
  const unresolvedSeasonRatingsQuery = useMemo(
    () => (rawDb ? buildUnresolvedSeasonRatingQuery(rawDb) : null),
    [rawDb],
  );
  const { data: unresolvedSeasonRatingRows } = useOptionalLiveQuery(
    unresolvedSeasonRatingsQuery,
    [] as { id: number }[],
  );

  // 5. Derived State (`useMemo`)
  const pendingOpsCount = pendingOperationRows.length + unresolvedSeasonRatingRows.length;
  const syncPrerequisites = resolveSyncPrerequisites({
    hasDatabase: rawDb !== null,
    configStatus,
    isConfigured,
  });

  // 6. Callbacks (`useCallback` calling pure helpers)
  const requestSync = useCallback((source: SyncRuntimeTriggerSource) => {
    if (syncPrerequisites === 'missing') {
      invalidateSyncConnectionOnline();
      return Promise.resolve(0);
    }

    // An 'unknown' verdict means this instance has not read the bridge config yet. Syncing would
    // run without a connection and publishing local mode would erase the shared online status,
    // so the honest answer is to do neither and let the next trigger find a settled config.
    if (syncPrerequisites !== 'ready' || !rawDb) {
      return Promise.resolve(0);
    }

    return runSharedForegroundSyncCycle(rawDb, () =>
      runCoordinatedForegroundSyncCycle({ rawDb, source, setActiveSeasonSnapshot }),
    );
  }, [rawDb, setActiveSeasonSnapshot, syncPrerequisites]);

  const manualSync = useCallback(() => requestSync('manual'), [requestSync]);

  // 7. Effects
  // Only a verdict this instance actually knows may erase the shared online status. Publishing an
  // 'unknown' verdict is what dropped a live bridge connection on every facade mount, so entering
  // Settings fell back to local mode until a manual sync.
  useEffect(() => {
    if (syncPrerequisites !== 'missing') {
      return;
    }

    invalidateSyncConnectionOnline();
  }, [syncPrerequisites]);

  return {
    connectionStatus: syncConnection.kind,
    lastSyncAt: syncConnection.lastSyncAt,
    pendingOpsCount,
    requestSync,
    syncError: syncConnection.message,
    manualSync,
  };
}
