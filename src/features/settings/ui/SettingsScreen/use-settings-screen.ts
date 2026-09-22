import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useSyncTelemetryPreference } from '../../use-sync-telemetry-preference';
import { useSettingsScreenActions } from './use-settings-screen-actions';
import { useSettingsScreenBackgroundSyncSection } from './use-settings-screen-background-sync-section';
import { useSettingsScreenBatteryExemption } from './use-settings-screen-battery-exemption';
import { useSettingsScreenDeviceOnline } from './use-settings-screen-device-online';
import { useSettingsScreenSyncSummary } from './use-settings-screen-sync-summary';
import { useSettingsScreenTheme } from './use-settings-screen-theme';
import type {
  ResolvedToneColors,
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
  const { isBatteryOptimizationExempt, handleRequestBatteryExemption } =
    useSettingsScreenBatteryExemption();

  // 5. Derived State (useMemo)
  // Memoized because it is handed straight to `SettingsSyncCard` as a prop: rebuilt inline on
  // every render it would be a new object identity each time and re-render that card for no
  // reason. It lives here rather than in the screen because `.tsx` files stay dumb UI.
  const toneColors: ResolvedToneColors = useMemo(
    () => ({
      foreground: themeColorForeground,
      muted: themeColorMuted,
      success: themeColorSuccess,
      warning: themeColorWarning,
      danger: themeColorDanger,
    }),
    [
      themeColorForeground,
      themeColorMuted,
      themeColorSuccess,
      themeColorWarning,
      themeColorDanger,
    ],
  );

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
    isBatteryOptimizationExempt,
    isUnpairing,
    layoutMode,
    syncSummary,
    toneColors,
    themeColorForeground,
    themeColorMuted,
    themeColorSuccess,
    themeColorWarning,
    themeColorDanger,
    handleGoToSetup,
    handleRePair,
    handleSyncSummaryAction,
    handleToggleSyncTelemetry,
    handleRequestBatteryExemption,
  };
}
