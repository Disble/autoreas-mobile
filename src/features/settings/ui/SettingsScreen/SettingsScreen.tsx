/* eslint-disable react-doctor/jsx-max-depth -- structurally unreachable here, not a style waiver:
 * the rule's limit of 2 is below the minimum nesting of a scroll container holding a centered
 * column of cards. Each card and the error banner are extracted; what remains is the screen's
 * own layout shell.
 */
import { Alert as HeroAlert, cn } from 'heroui-native';
import { View } from 'react-native';
import { ScreenScrollView } from '../../../../components/screen-scroll-view';
import { SettingsBackgroundCard } from './SettingsBackgroundCard';
import { SettingsConnectionCard } from './SettingsConnectionCard';
import { SettingsPrivacyCard } from './SettingsPrivacyCard';
import { SETTINGS_CONTAINER_WIDTH_CLASS } from './settings-screen.constants';
import { SettingsStatusCard } from './SettingsStatusCard';
import type { SettingsScreenProps } from './settings-screen.types';
import { useSettingsScreen } from './use-settings-screen';

/**
 * Renders the screen's action-failure banner. Extracted so the alert's own four-level compound
 * structure is not counted against the screen's JSX depth.
 */
function SettingsErrorAlert({ error }: Readonly<{ error: string }>) {
  return (
    <HeroAlert status="danger">
      <HeroAlert.Indicator />
      <HeroAlert.Content>
        <HeroAlert.Title>No se pudo completar la acción</HeroAlert.Title>
        <HeroAlert.Description>{error}</HeroAlert.Description>
      </HeroAlert.Content>
    </HeroAlert>
  );
}

/**
 * Renders the settings screen: the status card on top, then the connection card beside the
 * background and privacy cards on wide screens, or everything stacked on narrow ones.
 */
export function SettingsScreen(props: Readonly<SettingsScreenProps>) {
  const {
    backgroundStatus,
    connection,
    error,
    isUnpairing,
    layoutMode,
    syncSummary,
    statusIconColor,
    isSyncTelemetryEnabled,
    handleRePair,
    handleStatusAction,
    backgroundIssueActionHandlers,
    handleToggleSyncTelemetry,
  } = useSettingsScreen(props);

  const isWide = layoutMode === 'tablet-landscape';

  return (
    <ScreenScrollView contentContainerClassName="pb-10">
      <View
        className={cn(
          'mx-auto w-full gap-4 pt-4',
          SETTINGS_CONTAINER_WIDTH_CLASS[layoutMode],
        )}
      >
        <SettingsStatusCard
          handleStatusAction={handleStatusAction}
          iconColor={statusIconColor}
          summary={syncSummary}
        />

        <View className={cn('gap-4', isWide && 'flex-row items-start')}>
          {connection ? (
            <View className={cn(isWide && 'flex-1')}>
              <SettingsConnectionCard
                connection={connection}
                handleRePair={handleRePair}
                isUnpairing={isUnpairing}
              />
            </View>
          ) : null}
          <View className={cn('gap-4', isWide && 'flex-1')}>
            <SettingsBackgroundCard
              backgroundIssueActionHandlers={backgroundIssueActionHandlers}
              status={backgroundStatus}
            />
            <SettingsPrivacyCard
              handleToggleSyncTelemetry={handleToggleSyncTelemetry}
              isSyncTelemetryEnabled={isSyncTelemetryEnabled}
            />
          </View>
        </View>

        {error ? <SettingsErrorAlert error={error} /> : null}
      </View>
    </ScreenScrollView>
  );
}
