import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import { useThemeColor } from "heroui-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { useAppTheme } from "../../../../contexts/app-theme-context";
import { useResponsiveLayout } from "../../../../hooks/use-responsive-layout";
import { useIncrementalSyncHandler } from "../../../sync/use-incremental-sync-handler";
import { ANIME_DAY_FILTER_OPTIONS } from "../../anime.constants";
import {
  getAnimeDayFilterOption,
  getDefaultAnimeDayFilter,
} from "../../anime.helpers";
import type { AnimeDayFilter } from "../../anime.types";
import { useAnimeList } from "../../use-anime-list";
import { useMutateAnime } from "../../use-mutate-anime";
import { ANIME_LIST_SCREEN_REFRESH_LABEL } from "./anime-list-screen.constants";
import {
  buildContextualHeader,
  computeFilterCounts,
} from "./anime-list-screen.helpers";
import type {
  AnimeListScreenProps,
  AnimeListScreenViewModel,
  AnimeStateSheetRequest,
} from "./anime-list-screen.types";

export function useAnimeListScreen(
  _props: AnimeListScreenProps,
): AnimeListScreenViewModel {
  // 1. Refs
  const mutatingAnimeByIdRef = useRef<Record<string, boolean>>({});

  // 2. State
  const [selectedFilter, setSelectedFilter] = useState<AnimeDayFilter>(() =>
    getDefaultAnimeDayFilter(new Date()),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMutatingAnimeById, setIsMutatingAnimeById] = useState<
    Record<string, boolean>
  >({});
  const [stateSheetRequest, setStateSheetRequest] =
    useState<AnimeStateSheetRequest | null>(null);

  // 3. Context/3rd Party Hooks
  const router = useRouter();
  const { isDark } = useAppTheme();
  const [themeColorForeground] = useThemeColor(["foreground"]);
  const { handleSyncRequired } = useIncrementalSyncHandler();
  const { layout: layoutMode } = useResponsiveLayout();

  // 4. Queries/Mutations
  const { data: animes, allActiveAnimes } = useAnimeList(selectedFilter);
  const { capPlus, capMinus, capPlusHalf, capMinusHalf, setEstado } =
    useMutateAnime();

  // 5. Derived State (useMemo)
  const filterOptions = useMemo(() => ANIME_DAY_FILTER_OPTIONS, []);
  const isEmpty = useMemo(() => animes.length === 0, [animes]);
  const selectedFilterOption = useMemo(
    () => getAnimeDayFilterOption(selectedFilter),
    [selectedFilter],
  );
  const settingsHref = useMemo(() => "/(tabs)/settings" as Href, []);
  const today = useMemo(() => getDefaultAnimeDayFilter(new Date()), []);
  const filterCounts = useMemo(
    () => computeFilterCounts(allActiveAnimes ?? []),
    [allActiveAnimes],
  );
  const contextualHeader = useMemo(
    () => buildContextualHeader(selectedFilter, animes.length, new Date()),
    [selectedFilter, animes.length],
  );

  // 6. Callbacks (useCallback calling pure helpers)
  const handleSelectedFilterChange = useCallback((filter: AnimeDayFilter) => {
    setSelectedFilter(filter);
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);

    try {
      await handleSyncRequired();
    } catch (error) {
      console.warn("[AnimeListScreen] Manual refresh failed:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [handleSyncRequired]);

  const runMutation = useCallback(
    async (animeId: string, action: (id: string) => Promise<void>) => {
      if (mutatingAnimeByIdRef.current[animeId]) {
        return;
      }

      const nextMutatingState = {
        ...mutatingAnimeByIdRef.current,
        [animeId]: true,
      };
      mutatingAnimeByIdRef.current = nextMutatingState;
      setIsMutatingAnimeById(nextMutatingState);

      try {
        await action(animeId);
      } finally {
        const nextMutatingState = { ...mutatingAnimeByIdRef.current };
        delete nextMutatingState[animeId];
        mutatingAnimeByIdRef.current = nextMutatingState;
        setIsMutatingAnimeById(nextMutatingState);
      }
    },
    [],
  );

  const handleCapPlus = useCallback(
    (animeId: string) => runMutation(animeId, capPlus),
    [capPlus, runMutation],
  );

  const handleCapMinus = useCallback(
    (animeId: string) => runMutation(animeId, capMinus),
    [capMinus, runMutation],
  );

  const handleCapPlusHalf = useCallback(
    (animeId: string) => runMutation(animeId, capPlusHalf),
    [capPlusHalf, runMutation],
  );

  const handleCapMinusHalf = useCallback(
    (animeId: string) => runMutation(animeId, capMinusHalf),
    [capMinusHalf, runMutation],
  );

  const handleOpenStateSheet = useCallback(
    (animeId: string, currentEstado: number) => {
      setStateSheetRequest({ animeId, currentEstado });
    },
    [],
  );

  const handleCloseStateSheet = useCallback(() => {
    setStateSheetRequest(null);
  }, []);

  const handleStateSheetSelect = useCallback(
    async (estado: number) => {
      const request = stateSheetRequest;
      if (!request) {
        return;
      }
      setStateSheetRequest(null);
      await setEstado(request.animeId, estado);
    },
    [setEstado, stateSheetRequest],
  );

  const handleOpenSettings = useCallback(() => {
    router.push(settingsHref);
  }, [router, settingsHref]);

  // 7. Effects

  return {
    animes,
    filterOptions,
    filterCounts,
    contextualHeader,
    layoutMode,
    isMutatingAnimeById,
    isDark,
    isEmpty,
    isRefreshing,
    refreshAccessibilityLabel: ANIME_LIST_SCREEN_REFRESH_LABEL,
    selectedFilter,
    selectedFilterOption,
    settingsHref,
    stateSheetRequest,
    themeColorForeground,
    today,
    handleCapMinus,
    handleCapMinusHalf,
    handleCapPlus,
    handleCapPlusHalf,
    handleCloseStateSheet,
    handleOpenSettings,
    handleOpenStateSheet,
    handleRefresh,
    handleSelectedFilterChange,
    handleStateSheetSelect,
  };
}
