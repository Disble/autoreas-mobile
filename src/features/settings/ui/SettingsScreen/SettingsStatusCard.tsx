/* eslint-disable react-doctor/jsx-max-depth -- the HeroUI Native compound shapes this card must use
 * (`Card > Card.Body > View > Card.Title`, `Button > Button.Label`) are already deeper than the
 * rule's limit of 2 before any layout wrapper; the avoidable depth is extracted
 * (`SettingsStatusActionButton`).
 */
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, cn } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import {
  SETTINGS_STATUS_ICON_BG_CLASS,
  SETTINGS_STATUS_TITLE_CLASS,
} from './settings-screen.constants';
import type { SettingsStatusCardProps } from './settings-screen.types';

/** Renders the status card's single contextual action, primary only for pairing. */
function SettingsStatusActionButton(
  props: Readonly<Pick<SettingsStatusCardProps, 'summary' | 'handleStatusAction'>>,
) {
  const { summary, handleStatusAction } = props;

  if (!summary.action || !handleStatusAction) {
    return null;
  }

  return (
    <Button
      className={cn(summary.action.isDisabled && 'opacity-60')}
      isDisabled={summary.action.isDisabled}
      onPress={handleStatusAction}
      size="sm"
      variant={summary.action.kind === 'go_to_setup' ? 'primary' : 'secondary'}
    >
      <Button.Label>{summary.action.label}</Button.Label>
    </Button>
  );
}

/** Renders the status card: one answer to "are my changes reaching the PC?" and one action. */
export function SettingsStatusCard(props: Readonly<SettingsStatusCardProps>) {
  const { summary, iconColor, handleStatusAction } = props;

  return (
    <Card testID="settings-status-card">
      <Card.Body className="flex-row flex-wrap items-center gap-4">
        <View
          className={cn(
            'h-11 w-11 items-center justify-center rounded-2xl',
            SETTINGS_STATUS_ICON_BG_CLASS[summary.tone],
          )}
        >
          <Ionicons color={iconColor} name={summary.iconName} size={22} />
        </View>
        <View className="min-w-[200px] flex-1 gap-1">
          <Card.Title className={SETTINGS_STATUS_TITLE_CLASS[summary.tone]}>
            {summary.title}
          </Card.Title>
          <Card.Description>{summary.description}</Card.Description>
          {summary.meta ? (
            <AppText className="pt-1 text-xs text-muted">{summary.meta}</AppText>
          ) : null}
        </View>
        <SettingsStatusActionButton handleStatusAction={handleStatusAction} summary={summary} />
      </Card.Body>
    </Card>
  );
}
