import { FlatList, RefreshControl, View } from 'react-native';
import { AnimeCard } from '../AnimeCard';
import { AnimeEmptyState } from '../AnimeEmptyState';
import { ANIME_LIST_SCREEN_TABLET_LANDSCAPE_COLUMNS } from './anime-list-screen.constants';
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

  if (isEmpty) {
    return <AnimeEmptyState filter={selectedFilter} />;
  }

  return (
    <FlatList
      contentContainerClassName="mx-auto w-full max-w-5xl px-5 pb-12"
      data={animes}
      extraData={isMutatingAnimeById}
      key={`anime-list-${numColumns}`}
      keyExtractor={(item) => item._id}
      numColumns={numColumns}
      columnWrapperClassName={numColumns > 1 ? 'gap-4' : undefined}
      refreshControl={
        <RefreshControl
          enabled={isManualSyncEnabled}
          refreshing={isRefreshing}
          onRefresh={() => {
            void handleRefresh();
          }}
        />
      }
      renderItem={({ item }) => (
        <View className={numColumns > 1 ? 'flex-1' : undefined}>
          <AnimeCard {...getAnimeCardProps(item)} />
        </View>
      )}
      showsVerticalScrollIndicator={false}
    />
  );
}
