import { useMemo } from 'react';
import { useBridgeConfig } from '../../use-bridge-config';
import { useSyncFacade } from '../../../sync/use-sync-facade';
import {
  buildSettingsBridgeStatus,
  buildSettingsSyncSummary,
} from './settings-sync-status.helpers';
import type { SettingsScreenSyncSummaryResult } from './settings-screen.types';

/**
 * Resolves the bridge configuration, live sync facts, and the derived sync summary and
 * bridge status the Settings screen renders. Extracted as a facade hook (per the project's
 * Facade Hook pattern) so `useSettingsScreen` stays under its complexity and line budget.
 */
export function useSettingsScreenSyncSummary(
  isDeviceOnline: boolean | null,
): SettingsScreenSyncSummaryResult {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks

  // 4. Queries/Mutations
  const { config, isConfigured, isUnpairing, error, unpair } = useBridgeConfig();
  const { connectionStatus, lastSyncAt, pendingOpsCount, syncError } = useSyncFacade();

  // 5. Derived State (useMemo)
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

  // 7. Effects

  return {
    config,
    isConfigured,
    isUnpairing,
    error,
    unpair,
    syncSummary,
    bridgeStatus,
  };
}
