import { Alert as HeroAlert, cn } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { ScreenScrollView } from '../../../../components/screen-scroll-view';
import { SettingsBridgeCard } from './SettingsBridgeCard';
import { SettingsSyncCard } from './SettingsSyncCard';
import type {
  ResolvedToneColors,
  SettingsScreenProps,
} from './settings-screen.types';
import { useSettingsScreen } from './use-settings-screen';

export function SettingsScreen(props: SettingsScreenProps) {
  const {
    backgroundSyncSection,
    config,
    error,
    isConfigured,
    isUnpairing,
    layoutMode,
    themeColorDanger,
    themeColorForeground,
    themeColorMuted,
    themeColorSuccess,
    themeColorWarning,
    handleGoToSetup,
    handleRePair,
  } = useSettingsScreen(props);

  const toneColors: ResolvedToneColors = {
    foreground: themeColorForeground,
    muted: themeColorMuted,
    success: themeColorSuccess,
    warning: themeColorWarning,
    danger: themeColorDanger,
  };

  const isTabletLandscape = layoutMode === 'tablet-landscape';
  const isTabletPortrait = layoutMode === 'tablet-portrait';
  const containerWidthClass = isTabletLandscape
    ? 'max-w-[1120px]'
    : isTabletPortrait
      ? 'max-w-[760px]'
      : 'max-w-full';
  const sectionGapClass = isTabletLandscape ? 'gap-6' : 'gap-5';

  const bridgeSlot = (
    <SettingsBridgeCard
      config={config}
      handleGoToSetup={handleGoToSetup}
      handleRePair={handleRePair}
      isConfigured={isConfigured}
      isUnpairing={isUnpairing}
      layoutMode={layoutMode}
      themeColorForeground={themeColorForeground}
      themeColorMuted={themeColorMuted}
      themeColorSuccess={themeColorSuccess}
    />
  );

  const syncSlot = (
    <SettingsSyncCard
      colors={toneColors}
      layoutMode={layoutMode}
      section={backgroundSyncSection}
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

        {error ? (
          <HeroAlert status="danger">
            <HeroAlert.Indicator />
            <HeroAlert.Content>
              <HeroAlert.Title>No se pudo completar la acción</HeroAlert.Title>
              <HeroAlert.Description>{error}</HeroAlert.Description>
            </HeroAlert.Content>
          </HeroAlert>
        ) : null}
      </View>
    </ScreenScrollView>
  );
}
