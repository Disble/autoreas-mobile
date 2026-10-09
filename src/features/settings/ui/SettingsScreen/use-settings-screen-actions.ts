import { useCallback, useMemo } from 'react';
import { Alert, Linking } from 'react-native';
import type {
  UseSettingsScreenActionsInput,
  UseSettingsScreenActionsResult,
} from './settings-screen.types';

/**
 * Builds the actions the Settings screen exposes: the status card's contextual action (pairing or
 * a manual sync), the background issues' fixes, and the confirmation dialog that gates
 * re-pairing. Extracted as a facade hook (per the project's Facade Hook pattern) so
 * `useSettingsScreen` stays under its complexity and line budget.
 */
export function useSettingsScreenActions({
  router,
  unpair,
  manualSync,
  statusActionKind,
  handleRequestBatteryExemption,
}: UseSettingsScreenActionsInput): UseSettingsScreenActionsResult {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)

  // 6. Callbacks (useCallback calling pure helpers)
  const handleGoToSetup = useCallback(() => {
    router.push('/setup');
  }, [router]);

  const handleSyncNow = useCallback(() => {
    // The status card reflects the outcome through the live sync facts, so a failed manual sync
    // needs no extra surface here: the card already says the PC did not answer.
    manualSync().catch((error: unknown) => {
      console.warn('[SettingsScreen] Manual sync failed:', error);
    });
  }, [manualSync]);

  const handleRePair = useCallback(() => {
    Alert.alert(
      'Re-emparejar bridge',
      'Se va a borrar la configuración actual y volverás al setup. ¿Quieres continuar?',
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

  const handleOpenAppSettings = useCallback(() => {
    Linking.openSettings().catch(() => undefined);
  }, []);

  // Lookup tables, so the view picks a handler by kind instead of building a new closure per row.
  const statusActionHandlers = {
    go_to_setup: handleGoToSetup,
    sync_now: handleSyncNow,
  } as const;
  const backgroundIssueActionHandlers = useMemo(
    () => ({
      request_battery_exemption: handleRequestBatteryExemption,
      open_app_settings: handleOpenAppSettings,
    }),
    [handleOpenAppSettings, handleRequestBatteryExemption],
  );

  // 7. Effects

  return {
    handleRePair,
    handleStatusAction: statusActionKind ? statusActionHandlers[statusActionKind] : null,
    backgroundIssueActionHandlers,
  };
}
