import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useSyncTelemetryPreference } from '../../use-sync-telemetry-preference';
import { resolveToneIconColor } from './settings-screen.helpers';
import { useSettingsScreenActions } from './use-settings-screen-actions';
import { useSettingsScreenBackgroundStatus } from './use-settings-screen-background-status';
import { useSettingsScreenBatteryExemption } from './use-settings-screen-battery-exemption';
import { useSettingsScreenDeviceOnline } from './use-settings-screen-device-online';
import { useSettingsScreenSyncSummary } from './use-settings-screen-sync-summary';
import { useSettingsScreenTheme } from './use-settings-screen-theme';
import type { SettingsScreenProps, SettingsScreenViewModel } from './settings-screen.types';

/**
 * Coordinates settings screen state and actions.
 * Composes the Settings screen's facade hooks (theme/layout, device connectivity, status card,
 * background status, battery exemption and actions) so this hook stays a thin orchestrator
 * instead of restating their internals.
 */
export function useSettingsScreen(
  _props: SettingsScreenProps,
): SettingsScreenViewModel {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const router = useRouter();

  // 4. Queries/Mutations
  const { toneColors, layoutMode } = useSettingsScreenTheme();
  const isDeviceOnline = useSettingsScreenDeviceOnline();
  const { connection, isConfigured, isUnpairing, error, manualSync, unpair, syncSummary } =
    useSettingsScreenSyncSummary(isDeviceOnline);
  const { isBatteryExemptionHighlighted, handleRequestBatteryExemption } =
    useSettingsScreenBatteryExemption();
  const backgroundStatus = useSettingsScreenBackgroundStatus(
    isConfigured,
    isBatteryExemptionHighlighted,
  );
  const { isEnabled: isSyncTelemetryEnabled, setEnabled: setSyncTelemetryEnabled } =
    useSyncTelemetryPreference();

  // 5. Derived State (useMemo)
  const statusIconColor = resolveToneIconColor(syncSummary.tone, toneColors);

  // 6. Callbacks (useCallback calling pure helpers)
  const { handleRePair, handleStatusAction, backgroundIssueActionHandlers } = useSettingsScreenActions({
    router,
    unpair,
    manualSync,
    statusActionKind: syncSummary.action?.kind ?? null,
    handleRequestBatteryExemption,
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
    backgroundStatus,
    connection,
    error,
    isUnpairing,
    layoutMode,
    syncSummary,
    statusIconColor,
    isSyncTelemetryEnabled,
    handleRePair,
    handleStatusAction,
    backgroundIssueActionHandlers,
    handleToggleSyncTelemetry,
  };
}
