import { View } from 'react-native';
import { AnimeListScreenContent } from './AnimeListScreenContent';
import { AnimeListScreenListHead } from './AnimeListScreenListHead';
import type { AnimeListScreenListColumnProps } from './anime-list-screen.types';

/**
 * Renders the list column: its head (sync alert, subtitle, folder banner) above the scrolling list.
 * The alert lives here, so the filter panel beside it never moves.
 */
export function AnimeListScreenListColumn(props: Readonly<AnimeListScreenListColumnProps>) {
  const {
    animes,
    contextualHeader,
    isEmpty,
    isManualSyncEnabled,
    isMutatingAnimeById,
    isRefreshing,
    isSeasonMode,
    layoutMode,
    selectedFilter,
    syncStatus,
    getAnimeCardProps,
    handleOpenSettings,
    handleRefresh,
  } = props;

  return (
    <View
      className={layoutMode === 'tablet-landscape' ? 'flex-1 pl-4 pr-6 pt-1' : 'flex-1 px-4'}
      testID="anime-list-column"
    >
      <AnimeListScreenListHead
        contextualHeader={contextualHeader}
        isSeasonMode={isSeasonMode}
        syncStatus={syncStatus}
        handleOpenSettings={handleOpenSettings}
      />
      <AnimeListScreenContent
        animes={animes}
        isEmpty={isEmpty}
        isManualSyncEnabled={isManualSyncEnabled}
        isMutatingAnimeById={isMutatingAnimeById}
        isRefreshing={isRefreshing}
        layoutMode={layoutMode}
        selectedFilter={selectedFilter}
        getAnimeCardProps={getAnimeCardProps}
        handleRefresh={handleRefresh}
      />
    </View>
  );
}
