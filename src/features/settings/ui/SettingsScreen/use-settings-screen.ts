import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useThemeColor } from 'heroui-native';
import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useBridgeConfig } from '../../use-bridge-config';
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
  const [themeColorForeground, themeColorMuted] = useThemeColor([
    'foreground',
    'muted',
  ]);

  // 4. Queries/Mutations
  const { config, isConfigured, isUnpairing, error, unpair } = useBridgeConfig();

  // 5. Derived State (useMemo)

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
              router.replace('/setup' as Href);
            }
          },
        },
      ]
    );
  }, [router, unpair]);

  // 7. Effects

  return {
    config,
    error,
    isConfigured,
    isUnpairing,
    themeColorForeground,
    themeColorMuted,
    handleGoToSetup,
    handleRePair,
  };
}
