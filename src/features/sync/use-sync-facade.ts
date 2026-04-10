import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOptionalLiveQuery, useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime';
import { useBridgeConfig } from '../settings/use-bridge-config';
import { useWebSocket } from '../ws/use-websocket';
import {
  adaptAsyncSyncToVoidHandler,
  buildLocalAnimePresenceQuery,
  buildPendingOperationsQuery,
  resolveBootstrapMode,
  resolveBootstrapStrategy,
  transitionSyncState,
} from './sync-facade.helpers';
import { syncPendingOperations } from './reconcile.helpers';
import type { SyncState, UseSyncFacadeResult } from './sync-facade.types';

export function useSyncFacade(): UseSyncFacadeResult {
  // 1. Refs
  const hasBootstrappedRef = useRef(false);

  // 2. State
  const [syncState, setSyncState] = useState<SyncState>({ kind: 'idle' });
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  const { isConfigured } = useBridgeConfig();

  // 4. Queries/Mutations
  const localAnimePresenceQuery = useMemo(
    () => (rawDb ? buildLocalAnimePresenceQuery(rawDb) : null),
    [rawDb],
  );
  const pendingOperationsQuery = useMemo(
    () => (rawDb ? buildPendingOperationsQuery(rawDb) : null),
    [rawDb],
  );
  const { data: localAnimeRows } = useOptionalLiveQuery(localAnimePresenceQuery, [] as { id: string }[]);
  const { data: pendingOperationRows } = useOptionalLiveQuery(
    pendingOperationsQuery,
    [] as { id: number }[],
  );

  // 5. Derived State (`useMemo`)
  const hasLocalCache = useMemo(() => localAnimeRows.length > 0, [localAnimeRows]);
  const pendingOpsCount = useMemo(() => pendingOperationRows.length, [pendingOperationRows]);

  // 6. Callbacks (`useCallback` calling pure helpers)
  const handleSyncFailure = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Sync failed';

    setSyncError(message);
    setSyncState((currentState) =>
      transitionSyncState(currentState, { type: 'SYNC_FAILED', message }),
    );
  }, []);

  const manualSync = useCallback(async () => {
    if (!rawDb || !isConfigured) {
      setSyncError(null);
      setSyncState((currentState) => transitionSyncState(currentState, { type: 'MARK_OFFLINE' }));
      return 0;
    }

    setSyncError(null);
    setSyncState((currentState) => transitionSyncState(currentState, { type: 'SYNC_STARTED' }));

    try {
      const syncedCount = await syncPendingOperations(rawDb);
      const syncedAt = Date.now();

      setLastSyncAt(syncedAt);
      setSyncState((currentState) =>
        transitionSyncState(currentState, { type: 'SYNC_SUCCEEDED', syncedAt }),
      );

      return syncedCount;
    } catch (error) {
      handleSyncFailure(error);
      throw error;
    }
  }, [handleSyncFailure, isConfigured, rawDb]);

  const handleWebSocketSyncRequired = useMemo(
    () => adaptAsyncSyncToVoidHandler(manualSync, handleSyncFailure),
    [handleSyncFailure, manualSync],
  );

  // 7. Effects
  useWebSocket({ onSyncRequired: handleWebSocketSyncRequired });

  useEffect(() => {
    if (!rawDb || !isConfigured || hasBootstrappedRef.current) {
      if (!isConfigured) {
        setSyncError(null);
        setSyncState((currentState) =>
          transitionSyncState(currentState, { type: 'MARK_OFFLINE' }),
        );
      }
      return;
    }

    hasBootstrappedRef.current = true;
    setSyncError(null);
    setSyncState((currentState) => transitionSyncState(currentState, { type: 'SYNC_STARTED' }));

    const bootstrapMode = resolveBootstrapMode(hasLocalCache);
    const bootstrapStrategy = resolveBootstrapStrategy(bootstrapMode);

    void bootstrapStrategy({ rawDb })
      .then(() => {
        const syncedAt = Date.now();
        setLastSyncAt(syncedAt);
        setSyncState((currentState) =>
          transitionSyncState(currentState, { type: 'SYNC_SUCCEEDED', syncedAt }),
        );
      })
      .catch(handleSyncFailure);
  }, [handleSyncFailure, hasLocalCache, isConfigured, rawDb]);

  return {
    connectionStatus: syncState.kind,
    lastSyncAt,
    pendingOpsCount,
    syncError,
    manualSync,
  };
}
