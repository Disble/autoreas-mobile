import { Ionicons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { Alert as HeroAlert, Button, Card, cn, useThemeColor } from 'heroui-native';
import { Alert, View } from 'react-native';
import { ScreenScrollView } from '../../components/screen-scroll-view';
import { AppText } from '../../components/app-text';
import { useBridgeConfig } from '../../features/settings/use-bridge-config';

export default function SettingsScreen() {
  const router = useRouter();
  const { config, isConfigured, isUnpairing, error, unpair } = useBridgeConfig();
  const [themeColorForeground, themeColorMuted] = useThemeColor(['foreground', 'muted']);

  const handleGoToSetup = () => {
    router.push('/setup' as Href);
  };

  const handleRePair = () => {
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
  };

  return (
    <ScreenScrollView contentContainerClassName="gap-4 pb-10">
      <View className="gap-2 pt-4">
        <AppText className="text-2xl font-bold text-foreground">Configuración</AppText>
        <AppText className="text-sm text-muted">
          Revisá el bridge actual y reiniciá el emparejamiento cuando lo necesites.
        </AppText>
      </View>

      {isConfigured && config ? (
        <Card>
          <Card.Header className="flex-row items-center gap-3">
            <View className="rounded-full bg-secondary px-3 py-3">
              <Ionicons name="hardware-chip-outline" size={20} color={themeColorForeground} />
            </View>
            <View className="flex-1">
              <Card.Title>{config.deviceName || 'Bridge sin nombre'}</Card.Title>
              <Card.Description>Bridge actualmente emparejado</Card.Description>
            </View>
          </Card.Header>

          <Card.Body className="gap-4">
            <View className="gap-1">
              <AppText className="text-xs uppercase tracking-wide text-muted">Host</AppText>
              <AppText className="text-base text-foreground">
                {config.ip ?? 'Sin IP'}:{config.port ?? 'Sin puerto'}
              </AppText>
            </View>

            <View className="gap-1">
              <AppText className="text-xs uppercase tracking-wide text-muted">Device ID</AppText>
              <AppText className="text-base text-foreground">{config.deviceId}</AppText>
            </View>
          </Card.Body>

          <Card.Footer>
            <Button
              variant="danger-soft"
              onPress={handleRePair}
              isDisabled={isUnpairing}
              accessibilityLabel="Re-emparejar bridge"
              className={cn('w-full', isUnpairing && 'opacity-70')}
            >
              <Ionicons name="refresh-outline" size={18} color={themeColorForeground} />
              <Button.Label>{isUnpairing ? 'Re-emparejando...' : 'Re-emparejar'}</Button.Label>
            </Button>
          </Card.Footer>
        </Card>
      ) : (
        <Card variant="secondary">
          <Card.Body className="gap-4">
            <View className="items-center gap-3 py-2">
              <Ionicons name="cloud-offline-outline" size={40} color={themeColorMuted} />
              <View className="items-center gap-1">
                <Card.Title>Sin bridge configurado</Card.Title>
                <Card.Description className="text-center">
                  Todavía no hay un dispositivo vinculado en esta app.
                </Card.Description>
              </View>
            </View>

            <Button
              variant="primary"
              onPress={handleGoToSetup}
              accessibilityLabel="Ir al setup"
              className="w-full"
            >
              <Button.Label>Ir al setup</Button.Label>
            </Button>
          </Card.Body>
        </Card>
      )}

      {error ? (
        <HeroAlert status="danger">
          <HeroAlert.Indicator />
          <HeroAlert.Content>
            <HeroAlert.Title>No se pudo completar la acción</HeroAlert.Title>
            <HeroAlert.Description>{error}</HeroAlert.Description>
          </HeroAlert.Content>
        </HeroAlert>
      ) : null}
    </ScreenScrollView>
  );
}
