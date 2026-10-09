import { useMemo } from 'react';
import { useBackgroundSyncStatus } from '../../use-background-sync-status';
import { buildSettingsBackgroundStatus } from './settings-screen.helpers';
import type { SettingsBackgroundStatus } from './settings-screen.types';

/**
 * Reads the live runtime snapshot and derives what the background card shows. Extracted as a
 * facade hook (per the project's Facade Hook pattern) so `useSettingsScreen` stays a thin
 * orchestrator. Only the registration, execution mode and notification facts are read here; the
 * cycle counters stay in the snapshot for the telemetry that reaches the bridge.
 */
export function useSettingsScreenBackgroundStatus(
  isConfigured: boolean,
  isBatteryExemptionHighlighted: boolean,
): SettingsBackgroundStatus {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks

  // 4. Queries/Mutations
  const { snapshot } = useBackgroundSyncStatus();

  // 5. Derived State (useMemo)
  const { registrationStatus, executionMode, canShowPersistentNotification } = snapshot;
  const backgroundStatus = useMemo(
    () =>
      buildSettingsBackgroundStatus({
        isConfigured,
        isBatteryExemptionHighlighted,
        snapshot: { registrationStatus, executionMode, canShowPersistentNotification },
      }),
    [
      canShowPersistentNotification,
      executionMode,
      isBatteryExemptionHighlighted,
      isConfigured,
      registrationStatus,
    ],
  );

  // 6. Callbacks (useCallback calling pure helpers)

  // 7. Effects

  return backgroundStatus;
}
