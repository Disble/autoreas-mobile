import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { AnimeListScreenFilterSection } from './AnimeListScreenFilterSection';
import { AnimeListScreenListColumn } from './AnimeListScreenListColumn';
import { AnimeListScreenSheets } from './AnimeListScreenSheets';
import { buildAnimeListScreenOptions } from './anime-list-screen.helpers';
import type { AnimeListScreenViewProps } from './anime-list-screen.types';

/** Renders the anime list screen view interface. */
export function AnimeListScreenView(props: Readonly<AnimeListScreenViewProps>) {
  const { model } = props;
  const screenOptions = buildAnimeListScreenOptions(model);

  return (
    <View className="bg-background flex-1">
      <Stack.Screen options={screenOptions} />

      <View
        className={model.layoutMode === 'tablet-landscape' ? 'flex-1 flex-row pt-16' : 'flex-1 pt-16'}
      >
        <AnimeListScreenFilterSection
          filterOptions={model.filterOptions}
          filterCounts={model.filterCounts}
          selectedFilter={model.selectedFilter}
          today={model.today}
          layoutMode={model.layoutMode}
          handleSelectedFilterChange={model.handleSelectedFilterChange}
        />
        <AnimeListScreenListColumn
          animes={model.animes}
          contextualHeader={model.contextualHeader}
          isEmpty={model.isEmpty}
          isManualSyncEnabled={model.isManualSyncEnabled}
          isMutatingAnimeById={model.isMutatingAnimeById}
          isRefreshing={model.isRefreshing}
          isSeasonMode={model.isSeasonMode}
          layoutMode={model.layoutMode}
          selectedFilter={model.selectedFilter}
          syncStatus={model.syncStatus}
          getAnimeCardProps={model.getAnimeCardProps}
          handleOpenSettings={model.handleOpenSettings}
          handleRefresh={model.handleRefresh}
        />
      </View>

      <AnimeListScreenSheets
        stateSheetRequest={model.stateSheetRequest}
        seasonRatingSheetRequest={model.seasonRatingSheetRequest}
        isManualSyncEnabled={model.isManualSyncEnabled}
        isSyncSheetOpen={model.isSyncSheetOpen}
        syncStatus={model.syncStatus}
        handleCloseSeasonRatingSheet={model.handleCloseSeasonRatingSheet}
        handleCloseStateSheet={model.handleCloseStateSheet}
        handleCloseSyncSheet={model.handleCloseSyncSheet}
        handleOpenSettings={model.handleOpenSettings}
        handleRefresh={model.handleRefresh}
        handleSeasonRatingSubmit={model.handleSeasonRatingSubmit}
        handleStateSheetSelect={model.handleStateSheetSelect}
      />

      <StatusBar style={model.isDark ? 'light' : 'dark'} />
    </View>
  );
}
