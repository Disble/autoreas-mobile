import { Button, Card, cn } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { SETTINGS_CONNECTION_COPY } from './settings-screen.constants';
import type { SettingsConnectionCardProps } from './settings-screen.types';

/** Renders one labelled, selectable value of the connection card. */
function SettingsConnectionRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View className="flex-row items-center gap-3">
      <AppText className="w-32 text-[13px] text-muted">{label}</AppText>
      <AppText className="flex-1 text-[13px] font-semibold text-foreground" selectable>
        {value}
      </AppText>
    </View>
  );
}

/** Renders the secondary re-pair row with its explanation. */
function SettingsRePairRow(
  props: Readonly<Pick<SettingsConnectionCardProps, 'isUnpairing' | 'handleRePair'>>,
) {
  const { isUnpairing, handleRePair } = props;

  return (
    <View className="flex-row items-center gap-3">
      <View className="flex-1 gap-0.5">
        <AppText className="text-sm font-medium text-foreground">
          {SETTINGS_CONNECTION_COPY.rePairTitle}
        </AppText>
        <AppText className="text-xs leading-snug text-muted">
          {SETTINGS_CONNECTION_COPY.rePairDescription}
        </AppText>
      </View>
      <Button
        accessibilityLabel={SETTINGS_CONNECTION_COPY.rePairLabel}
        className={cn(isUnpairing && 'opacity-70')}
        isDisabled={isUnpairing}
        onPress={handleRePair}
        size="sm"
        variant="secondary"
      >
        <Button.Label>
          {isUnpairing ? SETTINGS_CONNECTION_COPY.rePairingLabel : SETTINGS_CONNECTION_COPY.rePairLabel}
        </Button.Label>
      </Button>
    </View>
  );
}

/** Renders the connection card: where the PC is, this device's id, and the re-pair action. */
export function SettingsConnectionCard(props: Readonly<SettingsConnectionCardProps>) {
  const { connection, isUnpairing, handleRePair } = props;

  return (
    <Card testID="settings-connection-card">
      <Card.Header>
        <AppText className="text-xs font-semibold uppercase tracking-wider text-muted">
          {SETTINGS_CONNECTION_COPY.title}
        </AppText>
      </Card.Header>
      <Card.Body className="gap-3 pt-3">
        <SettingsConnectionRow label={SETTINGS_CONNECTION_COPY.hostLabel} value={connection.host} />
        <SettingsConnectionRow
          label={SETTINGS_CONNECTION_COPY.deviceIdLabel}
          value={connection.deviceId}
        />
        <View className="h-px w-full bg-surface-secondary" />
        <SettingsRePairRow handleRePair={handleRePair} isUnpairing={isUnpairing} />
      </Card.Body>
    </Card>
  );
}
