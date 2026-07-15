import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { AnimeListScreenContent } from './AnimeListScreenContent';
import { AnimeListScreenFilterSection } from './AnimeListScreenFilterSection';
import { AnimeListScreenSheets } from './AnimeListScreenSheets';
import { AnimeListScreenStatusSection } from './AnimeListScreenStatusSection';
import {
  buildHeaderLeftRenderer,
  buildHeaderRightRenderer,
} from './anime-list-screen.helpers';
import type { AnimeListScreenViewProps } from './anime-list-screen.types';

/** Renders the anime list screen view interface. */
export function AnimeListScreenView(props: Readonly<AnimeListScreenViewProps>) {
  const { model } = props;
  const headerLeft = buildHeaderLeftRenderer({
    handleOpenSettings: model.handleOpenSettings,
    themeColorForeground: model.themeColorForeground,
  });
  const headerRight = buildHeaderRightRenderer({
    refreshAccessibilityLabel: model.refreshAccessibilityLabel,
    isRefreshing: model.isRefreshing,
    isManualSyncEnabled: model.isManualSyncEnabled,
    themeColorForeground: model.themeColorForeground,
    handleRefresh: model.handleRefresh,
  });

  return (
    <View className="bg-background flex-1">
      <Stack.Screen
        options={{
          headerTitle: model.contextualHeader.title,
          headerLeft,
          headerRight,
        }}
      />

      <View
        className={
          model.layoutMode === 'tablet-landscape'
            ? 'flex-1 flex-row pt-16'
            : 'flex-1 pt-16'
        }
      >
        <AnimeListScreenFilterSection
          filterOptions={model.filterOptions}
          filterCounts={model.filterCounts}
          selectedFilter={model.selectedFilter}
          today={model.today}
          layoutMode={model.layoutMode}
          handleSelectedFilterChange={model.handleSelectedFilterChange}
        />

        <View className="flex-1">
          <AnimeListScreenStatusSection
            contextualHeader={model.contextualHeader}
            isSeasonMode={model.isSeasonMode}
            syncStatus={model.syncStatus}
            handleOpenSettings={model.handleOpenSettings}
          />
          <AnimeListScreenContent
            animes={model.animes}
            isEmpty={model.isEmpty}
            isManualSyncEnabled={model.isManualSyncEnabled}
            isMutatingAnimeById={model.isMutatingAnimeById}
            isRefreshing={model.isRefreshing}
            layoutMode={model.layoutMode}
            selectedFilter={model.selectedFilter}
            getAnimeCardProps={model.getAnimeCardProps}
            handleRefresh={model.handleRefresh}
          />
        </View>
      </View>

      <AnimeListScreenSheets
        stateSheetRequest={model.stateSheetRequest}
        seasonRatingSheetRequest={model.seasonRatingSheetRequest}
        handleCloseSeasonRatingSheet={model.handleCloseSeasonRatingSheet}
        handleCloseStateSheet={model.handleCloseStateSheet}
        handleSeasonRatingSubmit={model.handleSeasonRatingSubmit}
        handleStateSheetSelect={model.handleStateSheetSelect}
      />

      <StatusBar style={model.isDark ? 'light' : 'dark'} />
    </View>
  );
}
