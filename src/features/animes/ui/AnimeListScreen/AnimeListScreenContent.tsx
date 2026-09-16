import { FlatList } from 'react-native';
import { AnimeEmptyState } from '../AnimeEmptyState';
import {
  ANIME_LIST_SCREEN_TABLET_LANDSCAPE_CELL_CLASS_NAME,
  ANIME_LIST_SCREEN_TABLET_LANDSCAPE_COLUMNS,
} from './anime-list-screen.constants';
import {
  buildAnimeListItemRenderer,
  buildAnimeListRefreshControl,
  getAnimeListItemKey,
} from './anime-list-screen.helpers';
import type { AnimeListScreenContentProps } from './anime-list-screen.types';

/** Renders either the empty state or the responsive anime grid. */
export function AnimeListScreenContent(props: Readonly<AnimeListScreenContentProps>) {
  const {
    animes,
    isEmpty,
    isManualSyncEnabled,
    isMutatingAnimeById,
    isRefreshing,
    layoutMode,
    selectedFilter,
    getAnimeCardProps,
    handleRefresh,
  } = props;
  const numColumns =
    layoutMode === 'tablet-landscape'
      ? ANIME_LIST_SCREEN_TABLET_LANDSCAPE_COLUMNS
      : 1;
  const cellClassName =
    numColumns > 1 ? ANIME_LIST_SCREEN_TABLET_LANDSCAPE_CELL_CLASS_NAME : undefined;
  const renderItem = buildAnimeListItemRenderer(getAnimeCardProps, cellClassName);
  const refreshControl = buildAnimeListRefreshControl(
    isManualSyncEnabled,
    isRefreshing,
    handleRefresh,
  );

  if (isEmpty) {
    return <AnimeEmptyState filter={selectedFilter} />;
  }

  return (
    <FlatList
      contentContainerClassName={
        numColumns > 1
          ? 'mx-auto w-full max-w-5xl px-3 pb-12'
          : 'mx-auto w-full max-w-5xl px-5 pb-12'
      }
      data={animes}
      extraData={isMutatingAnimeById}
      key={`anime-list-${numColumns}`}
      keyExtractor={getAnimeListItemKey}
      numColumns={numColumns}
      refreshControl={refreshControl}
      renderItem={renderItem}
      showsVerticalScrollIndicator={false}
    />
  );
}
