import * as Network from 'expo-network';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createNotifeeForegroundServiceAdapter } from './notifee-foreground-service-adapter';
import { useBridgeConfig } from '../settings/use-bridge-config';
import { useWebSocket } from '../ws/use-websocket';
import {
  isBackgroundSyncTaskRegistered,
  registerBackgroundSyncTask,
  unregisterBackgroundSyncTask,
} from './background-sync.task';
import { createSyncExecutionFacade } from './sync-execution-facade';
import { buildSyncExecutionStatusPatch } from './sync-execution-strategy.helpers';
import { updateSyncRuntimeStatusSnapshot } from './sync-runtime-status.helpers';
import { useSyncFacade } from './use-sync-facade';
import type { UseSyncRuntimeProps, UseSyncRuntimeResult } from './sync-runtime.types';
import { useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime';

export function useSyncRuntime(
  props: UseSyncRuntimeProps,
): UseSyncRuntimeResult {
  // 1. Refs
  const hasBootstrappedRef = useRef(false);
  const currentAppStateRef = useRef(AppState.currentState);
  const lastConnectivityRef = useRef<boolean | null>(null);

  // 2. State
  const [currentAppState, setCurrentAppState] = useState(AppState.currentState);
  const [executionMode, setExecutionMode] = useState<'best_effort_background_task' | 'android_foreground_service'>(
    'best_effort_background_task',
  );

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  const { isConfigured } = useBridgeConfig();
  const { requestSync } = useSyncFacade();

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)
  const isRuntimeEnabled = useMemo(
    () => props.isBootstrapped && isConfigured,
    [isConfigured, props.isBootstrapped],
  );
  const isWebSocketEnabled = useMemo(
    () => isRuntimeEnabled && currentAppState === 'active',
    [currentAppState, isRuntimeEnabled],
  );
  const syncExecutionFacade = useMemo(
    () =>
      createSyncExecutionFacade({
        strategies: [
          createNotifeeForegroundServiceAdapter(),
          {
            mode: 'best_effort_background_task',
            register: registerBackgroundSyncTask,
            unregister: unregisterBackgroundSyncTask,
            getStatus: async () => {
              const isRegistered = await isBackgroundSyncTaskRegistered();

              return {
                registrationStatus: isRegistered ? 'registered' : 'unregistered',
                executionMode: 'best_effort_background_task' as const,
                isForegroundServiceRunning: false,
                canShowPersistentNotification: false,
              };
            },
          },
        ],
      }),
    [],
  );

  // 6. Callbacks (`useCallback` calling pure helpers)
  const handleWebSocketSyncRequired = useCallback(() => {
    void requestSync('ws_sync_required');
  }, [requestSync]);

  // 7. Effects
  useWebSocket({
    enabled: isWebSocketEnabled,
    onSyncRequired: handleWebSocketSyncRequired,
  });

  useEffect(() => {
    if (!props.isBootstrapped) {
      return;
    }

    if (!rawDb) {
      return;
    }

    if (!isRuntimeEnabled) {
      hasBootstrappedRef.current = false;
      void Promise.all([
        unregisterBackgroundSyncTask(),
        syncExecutionFacade.unregisterCurrentStrategy(),
      ])
        .then(async () => syncExecutionFacade.getStatus())
        .then((status) => {
          setExecutionMode(status.executionMode);

          return updateSyncRuntimeStatusSnapshot(rawDb, buildSyncExecutionStatusPatch(status));
        })
        .catch(() => undefined);
      return;
    }

    if (syncExecutionFacade.hasCurrentStrategy()) {
      return;
    }

    void syncExecutionFacade
      .registerPreferredStrategy()
      .then(async () => syncExecutionFacade.getStatus())
      .then((status) => {
        setExecutionMode(status.executionMode);

        return updateSyncRuntimeStatusSnapshot(rawDb, buildSyncExecutionStatusPatch(status));
      })
      .catch(() =>
        updateSyncRuntimeStatusSnapshot(rawDb, {
          registrationStatus: 'unsupported',
        }).catch(() => undefined),
      );
  }, [isRuntimeEnabled, props.isBootstrapped, rawDb, syncExecutionFacade]);

  useEffect(() => {
    if (!isRuntimeEnabled) {
      hasBootstrappedRef.current = false;
      return;
    }

    if (hasBootstrappedRef.current) {
      return;
    }

    hasBootstrappedRef.current = true;
    void requestSync('bootstrap');
  }, [isRuntimeEnabled, requestSync]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const previousAppState = currentAppStateRef.current;

      currentAppStateRef.current = nextAppState;
      setCurrentAppState(nextAppState);

      if (previousAppState !== 'active' && nextAppState === 'active' && isRuntimeEnabled) {
        void requestSync('app_active');
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isRuntimeEnabled, requestSync]);

  useEffect(() => {
    const subscription = Network.addNetworkStateListener((state) => {
      const isConnected = state.isConnected === true;

      if (lastConnectivityRef.current === false && isConnected && isRuntimeEnabled) {
        void requestSync('network_regained');
      }

      lastConnectivityRef.current = isConnected;
    });

    return () => {
      subscription.remove();
    };
  }, [isRuntimeEnabled, requestSync]);

  return {
    currentAppState,
    executionMode,
    isRuntimeEnabled,
    isWebSocketEnabled,
  };
}
