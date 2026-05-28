import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useThemeColor } from 'heroui-native';
import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { useResponsiveLayout } from '../../../../hooks/use-responsive-layout';
import { useBackgroundSyncStatus } from '../../use-background-sync-status';
import { useBridgeConfig } from '../../use-bridge-config';
import { buildBackgroundSyncSection } from './settings-screen.helpers';
import type {
  SettingsScreenProps,
  SettingsScreenViewModel,
} from './settings-screen.types';

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

  // 4. Queries/Mutations
  const { snapshot } = useBackgroundSyncStatus();
  const { config, isConfigured, isUnpairing, error, unpair } = useBridgeConfig();

  // 5. Derived State (useMemo)
  const backgroundSyncSection = useMemo(
    () => buildBackgroundSyncSection({ isConfigured, snapshot }),
    [isConfigured, snapshot],
  );

  // 6. Callbacks (useCallback calling pure helpers)
  const handleGoToSetup = useCallback(() => {
    router.push('/setup' as Href);
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
          onPress: async () => {
            const result = await unpair();

            if (result.success) {
              router.replace('/setup?repair=1' as Href);
            }
          },
        },
      ]
    );
  }, [router, unpair]);

  // 7. Effects

  return {
    backgroundSyncSection,
    config,
    error,
    isConfigured,
    isUnpairing,
    layoutMode,
    themeColorForeground,
    themeColorMuted,
    themeColorSuccess,
    themeColorWarning,
    themeColorDanger,
    handleGoToSetup,
    handleRePair,
  };
}
