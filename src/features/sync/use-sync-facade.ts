import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOptionalLiveQuery, useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime';
import { useBridgeConfig } from '../settings/use-bridge-config';
import {
  buildPendingOperationsQuery,
  transitionSyncState,
} from './sync-facade.helpers';
import { syncPendingOperations } from './reconcile.helpers';
import type { SyncState, UseSyncFacadeResult } from './sync-facade.types';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';
import {
  recordSyncAttemptFailed,
  recordSyncAttemptStarted,
  recordSyncAttemptSucceeded,
} from './sync-runtime-status.helpers';

export function useSyncFacade(): UseSyncFacadeResult {
  // 1. Refs
  const inFlightSyncRef = useRef<Promise<number> | null>(null);

  // 2. State
  const [syncState, setSyncState] = useState<SyncState>({ kind: 'idle' });
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  const { isConfigured } = useBridgeConfig();

  // 4. Queries/Mutations
  const pendingOperationsQuery = useMemo(
    () => (rawDb ? buildPendingOperationsQuery(rawDb) : null),
    [rawDb],
  );
  const { data: pendingOperationRows } = useOptionalLiveQuery(
    pendingOperationsQuery,
    [] as { id: number }[],
  );

  // 5. Derived State (`useMemo`)
  const pendingOpsCount = useMemo(() => pendingOperationRows.length, [pendingOperationRows]);

  // 6. Callbacks (`useCallback` calling pure helpers)
  const handleSyncFailure = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Sync failed';

    setSyncError(message);
    setSyncState((currentState) =>
      transitionSyncState(currentState, { type: 'SYNC_FAILED', message }),
    );
  }, []);

  const requestSync = useCallback((source: SyncRuntimeTriggerSource) => {
    if (!rawDb || !isConfigured) {
      setSyncError(null);
      setSyncState((currentState) => transitionSyncState(currentState, { type: 'MARK_OFFLINE' }));
      return Promise.resolve(0);
    }

    if (inFlightSyncRef.current) {
      return inFlightSyncRef.current;
    }

    setSyncError(null);
    setSyncState((currentState) => transitionSyncState(currentState, { type: 'SYNC_STARTED' }));

    const attemptedAt = Date.now();
    const syncPromise = recordSyncAttemptStarted(rawDb, source, attemptedAt)
      .then(() => syncPendingOperations(rawDb))
      .then(async (result) => {
        const syncedAt = Date.now();

        await recordSyncAttemptSucceeded(rawDb, source, syncedAt, result.syncedCount);

        setLastSyncAt(syncedAt);
        setSyncState((currentState) =>
          transitionSyncState(currentState, { type: 'SYNC_SUCCEEDED', syncedAt }),
        );

        return result.syncedCount;
      })
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : 'Sync failed';

        await recordSyncAttemptFailed(rawDb, source, Date.now(), message);
        handleSyncFailure(error);
        throw error;
      })
      .finally(() => {
        inFlightSyncRef.current = null;
      });

    inFlightSyncRef.current = syncPromise;

    return syncPromise;
  }, [handleSyncFailure, isConfigured, rawDb]);

  const manualSync = useCallback(() => requestSync('manual'), [requestSync]);

  // 7. Effects
  useEffect(() => {
    if (rawDb && isConfigured) {
      return;
    }

    setSyncError(null);
    setSyncState((currentState) => transitionSyncState(currentState, { type: 'MARK_OFFLINE' }));
  }, [isConfigured, rawDb]);

  return {
    connectionStatus: syncState.kind,
    lastSyncAt,
    pendingOpsCount,
    requestSync,
    syncError,
    manualSync,
  };
}
