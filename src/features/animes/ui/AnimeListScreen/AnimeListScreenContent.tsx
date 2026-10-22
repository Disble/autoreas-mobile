import { FlatList, View } from 'react-native';
import { AnimeEmptyState } from '../AnimeEmptyState';
import {
  ANIME_LIST_SCREEN_INITIAL_ROWS_TO_RENDER,
  ANIME_LIST_SCREEN_MAX_ROWS_PER_BATCH,
  ANIME_LIST_SCREEN_TABLET_LANDSCAPE_CELL_CLASS_NAME,
  ANIME_LIST_SCREEN_TABLET_LANDSCAPE_COLUMNS,
  ANIME_LIST_SCREEN_WINDOW_SIZE,
} from './anime-list-screen.constants';
import {
  buildAnimeListItemRenderer,
  buildAnimeListRefreshControl,
  getAnimeListItemKey,
} from './anime-list-screen.helpers';
import type { AnimeListScreenContentProps } from './anime-list-screen.types';

/**
 * Renders either the empty state or the responsive anime grid. The grid scrolls inside a container
 * with the card radius, so a card leaving the viewport is clipped by a rounded corner instead of a
 * straight cut; the two-column grid's 8 pt cell insets are pulled back with a negative margin.
 * No `extraData`: a row's lock reaches it through `renderItem`, which changes with the lock, and each
 * row keeps its card unless that card's own props changed.
 */
export function AnimeListScreenContent(props: Readonly<AnimeListScreenContentProps>) {
  const {
    animes,
    isEmpty,
    isManualSyncEnabled,
    isRefreshing,
    layoutMode,
    selectedFilter,
    getAnimeListItemProps,
    handleRefresh,
  } = props;
  const numColumns =
    layoutMode === 'tablet-landscape'
      ? ANIME_LIST_SCREEN_TABLET_LANDSCAPE_COLUMNS
      : 1;
  const cellClassName =
    numColumns > 1 ? ANIME_LIST_SCREEN_TABLET_LANDSCAPE_CELL_CLASS_NAME : undefined;
  const renderItem = buildAnimeListItemRenderer(getAnimeListItemProps, cellClassName);
  const refreshControl = buildAnimeListRefreshControl(
    isManualSyncEnabled,
    isRefreshing,
    handleRefresh,
  );

  if (isEmpty) {
    return <AnimeEmptyState filter={selectedFilter} />;
  }

  return (
    <View
      className={
        numColumns > 1
          ? '-mx-2 mb-4 flex-1 overflow-hidden rounded-3xl'
          : 'mb-4 flex-1 overflow-hidden rounded-3xl'
      }
      testID="anime-list-container"
    >
      <FlatList
        contentContainerClassName="pb-12"
        data={animes}
        initialNumToRender={ANIME_LIST_SCREEN_INITIAL_ROWS_TO_RENDER}
        key={`anime-list-${numColumns}`}
        keyExtractor={getAnimeListItemKey}
        maxToRenderPerBatch={ANIME_LIST_SCREEN_MAX_ROWS_PER_BATCH}
        numColumns={numColumns}
        refreshControl={refreshControl}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        windowSize={ANIME_LIST_SCREEN_WINDOW_SIZE}
      />
    </View>
  );
}
