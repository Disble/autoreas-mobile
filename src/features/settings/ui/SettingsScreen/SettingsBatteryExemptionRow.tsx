/* eslint-disable react-doctor/jsx-max-depth -- same library floor as SettingsSyncCard.tsx: the
 * documented HeroUI Native shapes `HeroAlert > HeroAlert.Content > HeroAlert.Title` and
 * `Button > Button.Label` inside a layout `View` already exceed the rule's limit of 2. The avoidable
 * depth is extracted (`SettingsBatteryExemptionWarning`); what remains is the mandated library's.
 */
import { Button, Alert as HeroAlert } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { BATTERY_EXEMPTION_ROW_COPY } from './settings-screen.constants';
import type { SettingsBatteryExemptionRowProps } from './settings-screen.types';

/**
 * Renders the warning variant: the missing exemption is the one setting that silently stops
 * background sync, so it reads as an alert with its action right under it.
 */
function SettingsBatteryExemptionWarning(
  props: Readonly<Pick<SettingsBatteryExemptionRowProps, 'handleRequestBatteryExemption'>>,
) {
  return (
    <View className="gap-2" testID="settings-battery-exemption-warning">
      <HeroAlert status="warning">
        <HeroAlert.Indicator />
        <HeroAlert.Content>
          <HeroAlert.Title>{BATTERY_EXEMPTION_ROW_COPY.warningTitle}</HeroAlert.Title>
          <HeroAlert.Description>{BATTERY_EXEMPTION_ROW_COPY.warningDescription}</HeroAlert.Description>
        </HeroAlert.Content>
      </HeroAlert>
      <Button onPress={props.handleRequestBatteryExemption} size="sm" variant="primary">
        <Button.Label>{BATTERY_EXEMPTION_ROW_COPY.actionLabel}</Button.Label>
      </Button>
    </View>
  );
}

/**
 * Renders the battery-exemption row of the sync card: a warning while the exemption is missing on
 * a device that can request it, and the plain row otherwise.
 */
export function SettingsBatteryExemptionRow(props: Readonly<SettingsBatteryExemptionRowProps>) {
  const { handleRequestBatteryExemption, isBatteryExemptionHighlighted, isBatteryOptimizationExempt } =
    props;

  if (isBatteryExemptionHighlighted) {
    return (
      <SettingsBatteryExemptionWarning handleRequestBatteryExemption={handleRequestBatteryExemption} />
    );
  }

  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1 gap-1">
        <AppText className="text-sm font-medium text-foreground">
          {BATTERY_EXEMPTION_ROW_COPY.title}
        </AppText>
        <AppText className="text-xs leading-snug text-muted">
          {isBatteryOptimizationExempt
            ? BATTERY_EXEMPTION_ROW_COPY.exemptDescription
            : BATTERY_EXEMPTION_ROW_COPY.notExemptDescription}
        </AppText>
      </View>
      {isBatteryOptimizationExempt ? null : (
        <Button onPress={handleRequestBatteryExemption} size="sm" variant="secondary">
          <Button.Label>{BATTERY_EXEMPTION_ROW_COPY.actionLabel}</Button.Label>
        </Button>
      )}
    </View>
  );
}
