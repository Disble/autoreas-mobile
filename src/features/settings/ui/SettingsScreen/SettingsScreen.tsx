import { Ionicons } from '@expo/vector-icons';
import { Alert as HeroAlert, Button, Card, cn } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { ScreenScrollView } from '../../../../components/screen-scroll-view';
import { BACKGROUND_SYNC_SECTION_TITLE } from './settings-screen.constants';
import type { SettingsScreenProps } from './settings-screen.types';
import { useSettingsScreen } from './use-settings-screen';

export function SettingsScreen(props: SettingsScreenProps) {
  const {
    backgroundSyncSection,
    config,
    error,
    isConfigured,
    isUnpairing,
    themeColorForeground,
    themeColorMuted,
    handleGoToSetup,
    handleRePair,
  } = useSettingsScreen(props);

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
              <Ionicons
                color={themeColorForeground}
                name="hardware-chip-outline"
                size={20}
              />
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
              accessibilityLabel="Re-emparejar bridge"
              className={cn('w-full', isUnpairing && 'opacity-70')}
              isDisabled={isUnpairing}
              onPress={handleRePair}
              variant="danger-soft"
            >
              <Ionicons color={themeColorForeground} name="refresh-outline" size={18} />
              <Button.Label>
                {isUnpairing ? 'Re-emparejando...' : 'Re-emparejar'}
              </Button.Label>
            </Button>
          </Card.Footer>
        </Card>
      ) : (
        <Card variant="secondary">
          <Card.Body className="gap-4">
            <View className="items-center gap-3 py-2">
              <Ionicons
                color={themeColorMuted}
                name="cloud-offline-outline"
                size={40}
              />
              <View className="items-center gap-1">
                <Card.Title>Sin bridge configurado</Card.Title>
                <Card.Description className="text-center">
                  Todavía no hay un dispositivo vinculado en esta app.
                </Card.Description>
              </View>
            </View>

            <Button
              accessibilityLabel="Ir al setup"
              className="w-full"
              onPress={handleGoToSetup}
              variant="primary"
            >
              <Button.Label>Ir al setup</Button.Label>
            </Button>
          </Card.Body>
        </Card>
      )}

      <Card variant="secondary">
        <Card.Header className="gap-1">
          <Card.Title>{BACKGROUND_SYNC_SECTION_TITLE}</Card.Title>
          <Card.Description>
            Snapshot local del runtime para entender si el sync periódico está realmente disponible.
          </Card.Description>
        </Card.Header>

        <Card.Body className="gap-4">
          <HeroAlert status={backgroundSyncSection.statusTone}>
            <HeroAlert.Indicator />
            <HeroAlert.Content>
              <HeroAlert.Title>{backgroundSyncSection.title}</HeroAlert.Title>
              <HeroAlert.Description>{backgroundSyncSection.description}</HeroAlert.Description>
            </HeroAlert.Content>
          </HeroAlert>

          <View className="gap-3">
            {backgroundSyncSection.rows.map((row) => (
              <View className="gap-1" key={row.label}>
                <AppText className="text-xs uppercase tracking-wide text-muted">{row.label}</AppText>
                <AppText className="text-base text-foreground">{row.value}</AppText>
              </View>
            ))}
          </View>
        </Card.Body>
      </Card>

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
