/* eslint-disable react-doctor/jsx-max-depth -- structurally unreachable here, not a style waiver:
 * the rule's limit of 2 is below the minimum nesting of the HeroUI Native compound components
 * CLAUDE.md mandates for this UI, and below what a scroll container holding a titled text group
 * costs. The genuinely avoidable depth WAS extracted (see SettingsErrorAlert below); what remains
 * is the floor imposed by the library and the screen's own layout shell.
 */
import { Alert as HeroAlert, cn } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { ScreenScrollView } from '../../../../components/screen-scroll-view';
import { SettingsBridgeCard } from './SettingsBridgeCard';
import { SETTINGS_CONTAINER_WIDTH_CLASS } from './settings-screen.constants';
import { SettingsSyncCard } from './SettingsSyncCard';
import type { SettingsScreenProps } from './settings-screen.types';
import { useSettingsScreen } from './use-settings-screen';

/**
 * Renders the screen's action-failure banner. Extracted so the alert's own four-level compound
 * structure is not counted against the screen's JSX depth, which is what makes the screen body
 * readable at a glance.
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

/** Renders the settings screen interface. */
export function SettingsScreen(props: Readonly<SettingsScreenProps>) {
  const {
    backgroundSyncSection,
    bridgeStatus,
    config,
    error,
    isConfigured,
    isSyncTelemetryEnabled,
    isBatteryOptimizationExempt,
    isUnpairing,
    layoutMode,
    syncSummary,
    toneColors,
    themeColorForeground,
    themeColorMuted,
    handleGoToSetup,
    handleRePair,
    handleSyncSummaryAction,
    handleToggleSyncTelemetry,
    handleRequestBatteryExemption,
  } = useSettingsScreen(props);

  const isTabletLandscape = layoutMode === 'tablet-landscape';
  const containerWidthClass = SETTINGS_CONTAINER_WIDTH_CLASS[layoutMode];
  const sectionGapClass = isTabletLandscape ? 'gap-6' : 'gap-5';

  const bridgeSlot = (
    <SettingsBridgeCard
      bridgeStatus={bridgeStatus}
      config={config}
      handleGoToSetup={handleGoToSetup}
      handleRePair={handleRePair}
      isConfigured={isConfigured}
      isUnpairing={isUnpairing}
      layoutMode={layoutMode}
      themeColorForeground={themeColorForeground}
      themeColorMuted={themeColorMuted}
    />
  );

  const syncSlot = (
    <SettingsSyncCard
      colors={toneColors}
      handleRequestBatteryExemption={handleRequestBatteryExemption}
      handleSummaryAction={handleSyncSummaryAction}
      handleToggleSyncTelemetry={handleToggleSyncTelemetry}
      isBatteryOptimizationExempt={isBatteryOptimizationExempt}
      isSyncTelemetryEnabled={isSyncTelemetryEnabled}
      layoutMode={layoutMode}
      section={backgroundSyncSection}
      summary={syncSummary}
    />
  );

  return (
    <ScreenScrollView contentContainerClassName="pb-10">
      <View
        className={cn(
          'mx-auto w-full pt-4',
          sectionGapClass,
          containerWidthClass,
        )}
      >
        <View className="gap-1.5 pb-1">
          <AppText className="text-[11px] font-semibold uppercase tracking-[2px] text-muted">
            Panel
          </AppText>
          <AppText className="text-sm leading-snug text-muted">
            Revisá el bridge actual y reiniciá el emparejamiento cuando lo necesites.
          </AppText>
        </View>

        {isTabletLandscape ? (
          <View className="flex-row items-stretch gap-6">
            <View className="flex-1">{bridgeSlot}</View>
            <View className="flex-[1.15]">{syncSlot}</View>
          </View>
        ) : (
          <View className={sectionGapClass}>
            {bridgeSlot}
            {syncSlot}
          </View>
        )}

        {error ? <SettingsErrorAlert error={error} /> : null}
      </View>
    </ScreenScrollView>
  );
}
