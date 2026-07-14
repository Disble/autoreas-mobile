import { useNetworkState } from 'expo-network';
import { useRouter } from 'expo-router';
import { useThemeColor } from 'heroui-native';
import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { useResponsiveLayout } from '../../../../hooks/use-responsive-layout';
import { useBackgroundSyncStatus } from '../../use-background-sync-status';
import { useBridgeConfig } from '../../use-bridge-config';
import { useSyncFacade } from '../../../sync/use-sync-facade';
import {
  buildSettingsBridgeStatus,
  buildSettingsSyncSummary,
} from './settings-sync-status.helpers';
import {
  buildBackgroundSyncSection,
} from './settings-screen.helpers';
import type {
  SettingsScreenProps,
  SettingsScreenViewModel,
} from './settings-screen.types';

/** Coordinates settings screen state and actions. */
export function useSettingsScreen(
  _props: SettingsScreenProps,
): SettingsScreenViewModel {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const router = useRouter();
  const [
    themeColorForeground,
    themeColorMuted,
    themeColorSuccess,
    themeColorWarning,
    themeColorDanger,
  ] = useThemeColor([
    'foreground',
    'muted',
    'success',
    'warning',
    'danger',
  ]);
  const { layout: layoutMode } = useResponsiveLayout();
  const networkState = useNetworkState();

  // 4. Queries/Mutations
  const { snapshot } = useBackgroundSyncStatus();
  const { config, isConfigured, isUnpairing, error, unpair } = useBridgeConfig();
  const { connectionStatus, lastSyncAt, pendingOpsCount, syncError } = useSyncFacade();

  // 5. Derived State (useMemo)
  const backgroundSyncSection = useMemo(
    () => buildBackgroundSyncSection({ isConfigured, snapshot }),
    [isConfigured, snapshot],
  );
  const isDeviceOnline = useMemo(() => {
    if (typeof networkState.isInternetReachable === 'boolean') {
      return networkState.isInternetReachable;
    }

    if (typeof networkState.isConnected === 'boolean') {
      return networkState.isConnected;
    }

    return null;
  }, [networkState.isConnected, networkState.isInternetReachable]);
  const syncSummary = useMemo(
    () =>
      buildSettingsSyncSummary({
        isConfigured,
        isDeviceOnline,
        now: new Date(),
        syncFacts: {
          connectionStatus,
          lastSyncAt,
          pendingOpsCount,
          syncError,
        },
      }),
    [connectionStatus, isConfigured, isDeviceOnline, lastSyncAt, pendingOpsCount, syncError],
  );
  const bridgeStatus = useMemo(
    () => buildSettingsBridgeStatus(syncSummary),
    [syncSummary],
  );

  // 6. Callbacks (useCallback calling pure helpers)
  const handleGoToSetup = useCallback(() => {
    router.push('/setup');
  }, [router]);

  const handleRePair = useCallback(() => {
    Alert.alert(
      'Re-emparejar bridge',
      'Se va a borrar la configuración actual y vas a volver al setup. ¿Querés continuar?',
      [
        {
          text: 'Cancelar',
          style: 'cancel',
          onPress: () => undefined,
        },
        {
          text: 'Re-emparejar',
          style: 'destructive',
          onPress: () => {
            unpair()
              .then((result) => {
                if (result.success) {
                  router.replace('/setup?repair=1');
                }
              })
              .catch(() => undefined);
          },
        },
      ]
    );
  }, [router, unpair]);

  const handleSyncSummaryAction = useCallback(() => {
    if (syncSummary.actionKind === 'go_to_setup') {
      handleGoToSetup();
      return;
    }

    if (syncSummary.actionKind === 'repair_bridge') {
      handleRePair();
    }
  }, [handleGoToSetup, handleRePair, syncSummary.actionKind]);

  // 7. Effects

  return {
    backgroundSyncSection,
    bridgeStatus,
    config,
    error,
    isConfigured,
    isUnpairing,
    layoutMode,
    syncSummary,
    themeColorForeground,
    themeColorMuted,
    themeColorSuccess,
    themeColorWarning,
    themeColorDanger,
    handleGoToSetup,
    handleRePair,
    handleSyncSummaryAction:
      syncSummary.actionKind === null ? null : handleSyncSummaryAction,
  };
}
