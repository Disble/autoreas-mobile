import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useThemeColor } from 'heroui-native';
import { useCallback, useMemo, useState } from 'react';
import { useAppTheme } from '../../../../contexts/app-theme-context';
import {
  ANIME_DAY_FILTER_OPTIONS,
} from '../../anime.constants';
import {
  getAnimeDayFilterOption,
  getDefaultAnimeDayFilter,
} from '../../anime.helpers';
import { useMutateAnime } from '../../use-mutate-anime';
import type {
  AnimeListScreenProps,
  AnimeListScreenViewModel,
  RawAnimeDayFilterOption,
} from './anime-list-screen.types';
import type { AnimeDayFilter } from '../../anime.types';
import { useAnimeList } from '../../use-anime-list';
import { useIncrementalSyncHandler } from '../../../sync/use-incremental-sync-handler';
import { useWebSocket } from '../../../ws/use-websocket';
import {
  ANIME_LIST_SCREEN_REFRESH_LABEL,
  ANIME_LIST_SCREEN_SELECT_LABEL,
  ANIME_LIST_SCREEN_SELECT_PLACEHOLDER,
} from './anime-list-screen.constants';
import { resolveSelectedAnimeDayFilterOption } from './anime-list-screen.helpers';

export function useAnimeListScreen(
  _props: AnimeListScreenProps,
): AnimeListScreenViewModel {
  // 1. Refs

  // 2. State
  const [selectedFilter, setSelectedFilter] = useState<AnimeDayFilter>(() =>
    getDefaultAnimeDayFilter(new Date())
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMutatingAnimeById, setIsMutatingAnimeById] = useState<Record<string, boolean>>({});

  // 3. Context/3rd Party Hooks
  const router = useRouter();
  const { isDark } = useAppTheme();
  const [themeColorForeground] = useThemeColor(['foreground']);
  const { handleSyncRequired } = useIncrementalSyncHandler();

  // 4. Queries/Mutations
  const { data: animes } = useAnimeList(selectedFilter);
  const { capPlus, capMinus } = useMutateAnime();

  // 5. Derived State (useMemo)
  const filterOptions = useMemo(() => ANIME_DAY_FILTER_OPTIONS, []);
  const isEmpty = useMemo(() => animes.length === 0, [animes]);
  const selectedFilterOption = useMemo(
    () => getAnimeDayFilterOption(selectedFilter),
    [selectedFilter]
  );
  const settingsHref = useMemo(() => '/(tabs)/settings' as Href, []);

  // 6. Callbacks (useCallback calling pure helpers)
  const handleSelectedFilterChange = useCallback(
    (
      value:
        | RawAnimeDayFilterOption
        | readonly RawAnimeDayFilterOption[]
        | undefined
    ) => {
      const selectedOption = resolveSelectedAnimeDayFilterOption(value ?? undefined);

      if (!selectedOption) {
        return;
      }

      setSelectedFilter(selectedOption.value);
    },
    []
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);

    try {
      await handleSyncRequired();
    } catch (error) {
      console.warn('[AnimeListScreen] Manual refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [handleSyncRequired]);

  const handleCapPlus = useCallback(
    async (animeId: string) => {
      if (isMutatingAnimeById[animeId]) {
        return;
      }

      setIsMutatingAnimeById((current) => ({
        ...current,
        [animeId]: true,
      }));

      try {
        await capPlus(animeId);
      } finally {
        setIsMutatingAnimeById((current) => {
          const nextState = { ...current };
          delete nextState[animeId];
          return nextState;
        });
      }
    },
    [capPlus, isMutatingAnimeById],
  );

  const handleCapMinus = useCallback(
    async (animeId: string) => {
      if (isMutatingAnimeById[animeId]) {
        return;
      }

      setIsMutatingAnimeById((current) => ({
        ...current,
        [animeId]: true,
      }));

      try {
        await capMinus(animeId);
      } finally {
        setIsMutatingAnimeById((current) => {
          const nextState = { ...current };
          delete nextState[animeId];
          return nextState;
        });
      }
    },
    [capMinus, isMutatingAnimeById],
  );

  const handleOpenSettings = useCallback(() => {
    router.push(settingsHref);
  }, [router, settingsHref]);

  // 7. Effects
  useWebSocket({ onSyncRequired: handleSyncRequired });

  return {
    animes,
    filterOptions,
    isMutatingAnimeById,
    isDark,
    isEmpty,
    isRefreshing,
    refreshAccessibilityLabel: ANIME_LIST_SCREEN_REFRESH_LABEL,
    selectedFilter,
    selectedFilterOption,
    selectListLabel: ANIME_LIST_SCREEN_SELECT_LABEL,
    selectPlaceholder: ANIME_LIST_SCREEN_SELECT_PLACEHOLDER,
    settingsHref,
    themeColorForeground,
    handleCapMinus,
    handleCapPlus,
    handleOpenSettings,
    handleRefresh,
    handleSelectedFilterChange,
  };
}
