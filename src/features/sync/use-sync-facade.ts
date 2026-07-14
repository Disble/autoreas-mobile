import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useOptionalLiveQuery, useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime';
import { useActiveSeasonStore } from '../../infrastructure/store/active-season-store';
import { useBridgeConfig } from '../settings/use-bridge-config';
import {
  buildPendingOperationsQuery,
  buildUnresolvedSeasonRatingQuery,
  runCoordinatedForegroundSyncCycle,
} from './sync-facade.helpers';
import type { UseSyncFacadeResult } from './sync-facade.types';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';
import {
  getSyncConnectionSnapshot,
  invalidateSyncConnectionOnline,
  runSharedForegroundSyncCycle,
  subscribeSyncConnection,
} from './sync-connection-store';

/** Coordinates sync facade state and actions. */
export function useSyncFacade(): UseSyncFacadeResult {
  // 1. Refs
  // 2. State
  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  const { isConfigured } = useBridgeConfig();
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
  const pendingOpsCount = useMemo(
    () => pendingOperationRows.length + unresolvedSeasonRatingRows.length,
    [pendingOperationRows, unresolvedSeasonRatingRows],
  );

  // 6. Callbacks (`useCallback` calling pure helpers)
  const requestSync = useCallback((source: SyncRuntimeTriggerSource) => {
    if (!rawDb || !isConfigured) {
      invalidateSyncConnectionOnline();
      return Promise.resolve(0);
    }

    return runSharedForegroundSyncCycle(rawDb, () =>
      runCoordinatedForegroundSyncCycle({ rawDb, source, setActiveSeasonSnapshot }),
    );
  }, [isConfigured, rawDb, setActiveSeasonSnapshot]);

  const manualSync = useCallback(() => requestSync('manual'), [requestSync]);

  // 7. Effects
  useEffect(() => {
    if (rawDb && isConfigured) {
      return;
    }

    invalidateSyncConnectionOnline();
  }, [isConfigured, rawDb]);

  return {
    connectionStatus: syncConnection.kind,
    lastSyncAt: syncConnection.lastSyncAt,
    pendingOpsCount,
    requestSync,
    syncError: syncConnection.message,
    manualSync,
  };
}
