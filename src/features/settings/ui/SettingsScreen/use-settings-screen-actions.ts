import { useCallback } from 'react';
import { Alert } from 'react-native';
import type {
  UseSettingsScreenActionsInput,
  UseSettingsScreenActionsResult,
} from './settings-screen.types';

/**
 * Builds the navigation and re-pairing actions the Settings screen exposes, including the
 * confirmation dialog that gates unpairing. Extracted as a facade hook (per the project's
 * Facade Hook pattern) so `useSettingsScreen` stays under its complexity and line budget.
 */
export function useSettingsScreenActions({
  router,
  unpair,
  actionKind,
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
    if (actionKind === 'go_to_setup') {
      handleGoToSetup();
      return;
    }

    if (actionKind === 'repair_bridge') {
      handleRePair();
    }
  }, [actionKind, handleGoToSetup, handleRePair]);

  // 7. Effects

  return {
    handleGoToSetup,
    handleRePair,
    handleSyncSummaryAction: actionKind === null ? null : handleSyncSummaryAction,
  };
}
