import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useSyncTelemetryPreference } from '../../use-sync-telemetry-preference';
import { useSettingsScreenActions } from './use-settings-screen-actions';
import { useSettingsScreenBackgroundSyncSection } from './use-settings-screen-background-sync-section';
import { useSettingsScreenDeviceOnline } from './use-settings-screen-device-online';
import { useSettingsScreenSyncSummary } from './use-settings-screen-sync-summary';
import { useSettingsScreenTheme } from './use-settings-screen-theme';
import type {
  SettingsScreenProps,
  SettingsScreenViewModel,
} from './settings-screen.types';

/**
 * Coordinates settings screen state and actions.
 * Composes the Settings screen's facade hooks (theme/layout, device connectivity, sync
 * summary, background sync section, and navigation actions) so this hook stays a thin
 * orchestrator instead of restating their internals.
 */
export function useSettingsScreen(
  _props: SettingsScreenProps,
): SettingsScreenViewModel {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const router = useRouter();

  // 4. Queries/Mutations
  const {
    themeColorForeground,
    themeColorMuted,
    themeColorSuccess,
    themeColorWarning,
    themeColorDanger,
    layoutMode,
  } = useSettingsScreenTheme();
  const isDeviceOnline = useSettingsScreenDeviceOnline();
  const { config, isConfigured, isUnpairing, error, unpair, syncSummary, bridgeStatus } =
    useSettingsScreenSyncSummary(isDeviceOnline);
  const backgroundSyncSection = useSettingsScreenBackgroundSyncSection(isConfigured);
  const { isEnabled: isSyncTelemetryEnabled, setEnabled: setSyncTelemetryEnabled } =
    useSyncTelemetryPreference();

  // 5. Derived State (useMemo)

  // 6. Callbacks (useCallback calling pure helpers)
  const { handleGoToSetup, handleRePair, handleSyncSummaryAction } = useSettingsScreenActions({
    router,
    unpair,
    actionKind: syncSummary.actionKind,
  });
  const handleToggleSyncTelemetry = useCallback(
    (nextEnabled: boolean) => {
      // Fire-and-forget on purpose: the switch reflects persisted state through the live query,
      // so awaiting here would only delay the render without changing what the user ends up
      // seeing. A failed write leaves the switch where it was, which is the honest outcome.
      void setSyncTelemetryEnabled(nextEnabled);
    },
    [setSyncTelemetryEnabled],
  );

  // 7. Effects

  return {
    backgroundSyncSection,
    bridgeStatus,
    config,
    error,
    isConfigured,
    isSyncTelemetryEnabled,
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
    handleSyncSummaryAction,
    handleToggleSyncTelemetry,
  };
}
