import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useOptionalLiveQuery, useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime/native-runtime.helpers';
import { useBridgeConfig } from '../settings/use-bridge-config';
import {
  buildPendingOperationsQuery,
  buildUnresolvedSeasonRatingQuery,
  resolveSyncPrerequisites,
} from './sync-facade.helpers';
import type { UseSyncFacadeResult } from './sync-facade.types';
import { requestFlush } from './sync-flush.helpers';
import type { SyncFlushReason } from './sync-flush.types';
import {
  getSyncConnectionSnapshot,
  invalidateSyncConnectionOnline,
  subscribeSyncConnection,
} from './sync-connection-store/sync-connection-store.helpers';

/** Coordinates sync facade state and actions. */
export function useSyncFacade(): UseSyncFacadeResult {
  // 1. Refs
  // 2. State
  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  const { configStatus, isConfigured } = useBridgeConfig();
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
  const requestSync = useCallback((reason: SyncFlushReason) => {
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

    // The single entry point (ADR 009 R-2): it runs the registered dispatcher's cycle, or joins
    // the one follow-up queued behind a running cycle.
    return requestFlush(rawDb, reason);
  }, [rawDb, syncPrerequisites]);

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
    manualSync,
  };
}
