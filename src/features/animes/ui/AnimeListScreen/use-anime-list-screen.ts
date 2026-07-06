import { useNetworkState } from "expo-network";
import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import { useThemeColor, useToast } from "heroui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppTheme } from "../../../../contexts/app-theme-context";
import { useSeasonModeStore } from "../../../../infrastructure/store/season-mode-store";
import { useResponsiveLayout } from "../../../../hooks/use-responsive-layout";
import { useBridgeConfig } from "../../../settings/use-bridge-config";
import { useSyncFacade } from "../../../sync/use-sync-facade";
import { ANIME_DAY_FILTER_OPTIONS } from "../../anime.constants";
import {
  getAnimeDayFilterOption,
  getDefaultAnimeDayFilter,
} from "../../anime.helpers";
import type { AnimeDayFilter } from "../../anime.types";
import { useAnimeList } from "../../use-anime-list";
import { useMutateAnime } from "../../use-mutate-anime";
import { useSeasonRatingIntent } from "../../use-season-rating-intent";
import { ANIME_LIST_SCREEN_REFRESH_LABEL } from "./anime-list-screen.constants";
import {
  buildRefreshFailureFeedback,
  buildContextualHeader,
  computeFilterCounts,
  deriveManualSyncEnabled,
  deriveVisibleSyncStatus,
} from "./anime-list-screen.helpers";
import type {
  AnimeListScreenProps,
  AnimeListScreenViewModel,
  AnimeStateSheetRequest,
  SeasonRatingSheetRequest,
} from "./anime-list-screen.types";
import type { SeasonRatingValue } from "../SeasonRatingSheet/season-rating-sheet.types";

export function useAnimeListScreen(
  _props: AnimeListScreenProps,
): AnimeListScreenViewModel {
  // 1. Refs
  const mutatingAnimeByIdRef = useRef<Record<string, boolean>>({});
  const hasUserSelectedFilterRef = useRef(false);

  // 2. State
  const [selectedFilter, setSelectedFilter] = useState<AnimeDayFilter>(() =>
    getDefaultAnimeDayFilter(new Date(), useSeasonModeStore.getState().seasonMode),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMutatingAnimeById, setIsMutatingAnimeById] = useState<
    Record<string, boolean>
  >({});
  const [stateSheetRequest, setStateSheetRequest] =
    useState<AnimeStateSheetRequest | null>(null);
  const [seasonRatingSheetRequest, setSeasonRatingSheetRequest] =
    useState<SeasonRatingSheetRequest | null>(null);

  // 3. Context/3rd Party Hooks
  const router = useRouter();
  const { toast } = useToast();
  const { isDark } = useAppTheme();
  const [themeColorForeground] = useThemeColor(["foreground"]);
  const { layout: layoutMode } = useResponsiveLayout();
  const networkState = useNetworkState();
  const seasonMode = useSeasonModeStore((state) => state.seasonMode);

  // 4. Queries/Mutations
  const { data: animes, allActiveAnimes } = useAnimeList(selectedFilter);
  const { capPlus, capMinus, capPlusHalf, capMinusHalf, setEstado } =
    useMutateAnime();
  const { submitSeasonRatingIntent } = useSeasonRatingIntent();
  const { isConfigured } = useBridgeConfig();
  const { connectionStatus, lastSyncAt, manualSync, pendingOpsCount, syncError } =
    useSyncFacade();

  // 5. Derived State (useMemo)
  const filterOptions = useMemo(() => ANIME_DAY_FILTER_OPTIONS, []);
  const isEmpty = useMemo(() => animes.length === 0, [animes]);
  const selectedFilterOption = useMemo(
    () => getAnimeDayFilterOption(selectedFilter),
    [selectedFilter],
  );
  const settingsHref = useMemo(() => "/(tabs)/settings" as Href, []);
  const today = useMemo(() => getDefaultAnimeDayFilter(new Date()), []);
  const isDeviceOnline = useMemo(() => {
    if (typeof networkState.isInternetReachable === "boolean") {
      return networkState.isInternetReachable;
    }

    if (typeof networkState.isConnected === "boolean") {
      return networkState.isConnected;
    }

    return null;
  }, [networkState.isConnected, networkState.isInternetReachable]);
  const filterCounts = useMemo(
    () => computeFilterCounts(allActiveAnimes ?? []),
    [allActiveAnimes],
  );
  const contextualHeader = useMemo(
    () => buildContextualHeader(selectedFilter, animes.length, new Date()),
    [selectedFilter, animes.length],
  );
  const syncStatus = useMemo(
    () =>
      deriveVisibleSyncStatus(
        {
          connectionStatus,
          isBridgeConfigured: isConfigured,
          isDeviceOnline,
          lastSyncAt,
          pendingOpsCount,
          syncError,
        },
        new Date(),
      ),
    [connectionStatus, isConfigured, isDeviceOnline, lastSyncAt, pendingOpsCount, syncError],
  );
  const isManualSyncEnabled = useMemo(
    () =>
      deriveManualSyncEnabled({
        connectionStatus,
        isBridgeConfigured: isConfigured,
        isDeviceOnline,
        isRefreshing,
        lastSyncAt,
        pendingOpsCount,
        syncError,
      }),
    [
      connectionStatus,
      isConfigured,
      isDeviceOnline,
      isRefreshing,
      lastSyncAt,
      pendingOpsCount,
      syncError,
    ],
  );

  // 6. Callbacks (useCallback calling pure helpers)
  const handleSelectedFilterChange = useCallback((filter: AnimeDayFilter) => {
    hasUserSelectedFilterRef.current = true;
    setSelectedFilter(filter);
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!isManualSyncEnabled) {
      return;
    }

    setIsRefreshing(true);

    try {
      await manualSync();
    } catch (error) {
      console.warn("[AnimeListScreen] Manual refresh failed:", error);
      const feedback = buildRefreshFailureFeedback({
        connectionStatus,
        isBridgeConfigured: isConfigured,
        isDeviceOnline,
        lastSyncAt,
        pendingOpsCount,
        syncError,
      });

      toast.show({
        variant: "warning",
        label: feedback.label,
        description: feedback.description,
        duration: 4000,
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [
    connectionStatus,
    isConfigured,
    isManualSyncEnabled,
    isDeviceOnline,
    lastSyncAt,
    manualSync,
    pendingOpsCount,
    syncError,
    toast,
  ]);

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

  const handleOpenSeasonRatingSheet = useCallback(
    (animeId: string) => {
      const anime = animes.find((currentAnime) => currentAnime._id === animeId);
      const seasonProjection = anime?.seasonProjection ?? null;
      if (!anime || !seasonProjection) {
        return;
      }

      setSeasonRatingSheetRequest({
        animeId,
        animeTitle: anime.nombre,
        bridgeRating: seasonProjection.bridgeRating,
        pendingRating: seasonProjection.localIntent?.nota ?? null,
        pendingStatus:
          seasonProjection.localIntent?.status === "failed"
            ? "failed"
            : seasonProjection.localIntent?.status === "pending"
              ? "pending"
              : null,
        pendingFailureKind: seasonProjection.localIntent?.failureKind ?? null,
      });
    },
    [animes],
  );

  const handleCloseSeasonRatingSheet = useCallback(() => {
    setSeasonRatingSheetRequest(null);
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

  const handleSeasonRatingSubmit = useCallback(
    async (rating: SeasonRatingValue) => {
      const request = seasonRatingSheetRequest;
      if (!request) {
        return;
      }

      await submitSeasonRatingIntent(request.animeId, rating);
      setSeasonRatingSheetRequest(null);
    },
    [seasonRatingSheetRequest, submitSeasonRatingIntent],
  );

  const handleOpenSettings = useCallback(() => {
    router.push(settingsHref);
  }, [router, settingsHref]);

  // 7. Effects
  // Soft-follow the season-mode default: while the user has not manually picked a filter,
  // keep the active filter aligned with the bridge-owned season mode (ON -> 'Ver hoy',
  // OFF -> today's weekday). Once the user chooses a filter, this stops overriding them.
  useEffect(() => {
    if (hasUserSelectedFilterRef.current) {
      return;
    }

    setSelectedFilter(getDefaultAnimeDayFilter(new Date(), seasonMode));
  }, [seasonMode]);

  return {
    isSeasonMode: seasonMode,
    animes,
    filterOptions,
    filterCounts,
    contextualHeader,
    layoutMode,
    isMutatingAnimeById,
    isDark,
    isEmpty,
    isRefreshing,
    isManualSyncEnabled,
    refreshAccessibilityLabel: ANIME_LIST_SCREEN_REFRESH_LABEL,
    selectedFilter,
    syncStatus,
    selectedFilterOption,
    settingsHref,
    stateSheetRequest,
    seasonRatingSheetRequest,
    themeColorForeground,
    today,
    handleCapMinus,
    handleCapMinusHalf,
    handleCapPlus,
    handleCapPlusHalf,
    handleCloseStateSheet,
    handleCloseSeasonRatingSheet,
    handleOpenSettings,
    handleOpenSeasonRatingSheet,
    handleOpenStateSheet,
    handleRefresh,
    handleSelectedFilterChange,
    handleSeasonRatingSubmit,
    handleStateSheetSelect,
  };
}
