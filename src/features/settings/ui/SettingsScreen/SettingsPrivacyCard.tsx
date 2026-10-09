/* eslint-disable react-doctor/jsx-max-depth -- `Card > Card.Body > View > View > AppText` is the
 * floor of a labelled switch row inside the mandated HeroUI Native card.
 */
import { Card, Switch } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { SETTINGS_PRIVACY_COPY } from './settings-screen.constants';
import type { SettingsPrivacyCardProps } from './settings-screen.types';

/** Renders the privacy card holding the diagnostics switch. */
export function SettingsPrivacyCard(props: Readonly<SettingsPrivacyCardProps>) {
  const { isSyncTelemetryEnabled, handleToggleSyncTelemetry } = props;

  return (
    <Card testID="settings-privacy-card">
      <Card.Header>
        <AppText className="text-xs font-semibold uppercase tracking-wider text-muted">
          {SETTINGS_PRIVACY_COPY.title}
        </AppText>
      </Card.Header>
      <Card.Body className="pt-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 gap-1">
            <AppText className="text-sm font-medium text-foreground">
              {SETTINGS_PRIVACY_COPY.telemetryLabel}
            </AppText>
            <AppText className="text-xs leading-snug text-muted">
              {SETTINGS_PRIVACY_COPY.telemetryDescription}
            </AppText>
          </View>
          <Switch
            accessibilityLabel={SETTINGS_PRIVACY_COPY.telemetryLabel}
            isSelected={isSyncTelemetryEnabled}
            onSelectedChange={handleToggleSyncTelemetry}
          />
        </View>
      </Card.Body>
    </Card>
  );
}
