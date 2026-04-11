import { Ionicons } from '@expo/vector-icons';
import { Button, Card, cn } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import type { SettingsBridgeCardProps } from './settings-screen.types';

export function SettingsBridgeCard(props: SettingsBridgeCardProps) {
  const {
    config,
    handleGoToSetup,
    handleRePair,
    isConfigured,
    isUnpairing,
    layoutMode,
    themeColorForeground,
    themeColorMuted,
    themeColorSuccess,
  } = props;

  const isTabletLandscape = layoutMode === 'tablet-landscape';

  if (!isConfigured || !config) {
    return (
      <Card className="flex-1" variant="secondary">
        <Card.Body className="flex-1 items-center justify-center gap-4 py-6">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-warning/15">
            <Ionicons
              color={themeColorMuted}
              name="cloud-offline-outline"
              size={32}
            />
          </View>
          <View className="items-center gap-1">
            <Card.Title>Sin bridge configurado</Card.Title>
            <Card.Description className="text-center">
              Todavía no hay un dispositivo vinculado en esta app.
            </Card.Description>
          </View>
          <Button
            accessibilityLabel="Ir al setup"
            className={cn(isTabletLandscape ? 'self-center px-8' : 'w-full')}
            onPress={handleGoToSetup}
            variant="primary"
          >
            <Ionicons
              color={themeColorForeground}
              name="link-outline"
              size={16}
            />
            <Button.Label>Emparejar bridge</Button.Label>
          </Button>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className="flex-1">
      <Card.Header className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-2xl bg-accent/15">
          <Ionicons
            color={themeColorForeground}
            name="hardware-chip-outline"
            size={20}
          />
        </View>
        <View className="flex-1 gap-0.5">
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <Card.Title numberOfLines={1}>
              {config.deviceName || 'Bridge sin nombre'}
            </Card.Title>
            <View className="flex-row items-center gap-1 rounded-full bg-success/15 px-2 py-0.5">
              <View
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: themeColorSuccess }}
              />
              <AppText className="text-[10px] font-semibold uppercase tracking-wider text-success">
                Emparejado
              </AppText>
            </View>
          </View>
          <Card.Description numberOfLines={1}>
            Conexión local lista para sincronizar
          </Card.Description>
        </View>
      </Card.Header>

      <Card.Body className="flex-1 gap-2.5 pt-4">
        <View className="flex-row items-center gap-3 rounded-2xl bg-surface-secondary px-3 py-2.5">
          <View className="h-8 w-8 items-center justify-center rounded-full bg-accent/15">
            <Ionicons
              color={themeColorForeground}
              name="wifi-outline"
              size={15}
            />
          </View>
          <View className="flex-1 gap-0.5">
            <AppText className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Host
            </AppText>
            <AppText
              className="text-[13px] font-semibold text-foreground"
              numberOfLines={1}
            >
              {config.ip ?? 'Sin IP'}:{config.port ?? 'Sin puerto'}
            </AppText>
          </View>
        </View>

        <View className="flex-row items-center gap-3 rounded-2xl bg-surface-secondary px-3 py-2.5">
          <View className="h-8 w-8 items-center justify-center rounded-full bg-accent/15">
            <Ionicons
              color={themeColorForeground}
              name="finger-print-outline"
              size={15}
            />
          </View>
          <View className="flex-1 gap-0.5">
            <AppText className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Device ID
            </AppText>
            <AppText
              className="text-[13px] font-semibold text-foreground"
              numberOfLines={1}
            >
              {config.deviceId}
            </AppText>
          </View>
        </View>
      </Card.Body>

      <Card.Footer className="pt-4">
        <Button
          accessibilityLabel="Re-emparejar bridge"
          className={cn('w-full', isUnpairing && 'opacity-70')}
          isDisabled={isUnpairing}
          onPress={handleRePair}
          size="sm"
          variant="danger-soft"
        >
          <Ionicons
            color={themeColorForeground}
            name="refresh-outline"
            size={15}
          />
          <Button.Label>
            {isUnpairing ? 'Re-emparejando...' : 'Re-emparejar'}
          </Button.Label>
        </Button>
      </Card.Footer>
    </Card>
  );
}
