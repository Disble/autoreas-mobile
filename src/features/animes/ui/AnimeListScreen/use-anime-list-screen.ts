import { useNetworkState } from "expo-network";
import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import { useThemeColor, useToast } from "heroui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppTheme } from "../../../../contexts/app-theme-context";
import useHeaderHeight from "../../../../helpers/hooks/use-header-height";
import { useResponsiveLayout } from "../../../../hooks/use-responsive-layout";
import { useBridgeConfig } from "../../../settings/use-bridge-config";
import { isSyncTelemetryEnabled } from "../../../sync/sync-telemetry-preference.helpers";
import { useSyncFacade } from "../../../sync/use-sync-facade";
import { ANIME_DAY_FILTER_OPTIONS } from "../../anime.constants";
import {
  getAnimeDayFilterOption,
  getDefaultAnimeDayFilter,
} from "../../anime.helpers";
import type { AnimeListItem } from "../../anime-season.types";
import type { AnimeDayFilter } from "../../anime.types";
import type { ChapterActionLabel } from "../../chapter-action-diagnostics.types";
import { buildAnimeMutationFailureFeedback } from "../../anime-mutation-failure.helpers";
import { useAnimeList } from "../../use-anime-list";
import { useMutateAnime } from "../../use-mutate-anime";
import { useSeasonRatingIntent } from "../../use-season-rating-intent";
import {
  runChapterMutation,
  runManualRefresh,
} from "./anime-list-screen-callback.helpers";
import { ANIME_LIST_SCREEN_REFRESH_LABEL } from "./anime-list-screen.constants";
import {
  buildContextualHeader,
  computeFilterCounts,
  deriveManualSyncEnabled,
  deriveHeaderLayout,
  deriveVisibleSyncStatus,
} from "./anime-list-screen.helpers";
import type {
  AnimeListScreenChapterActionRunner,
  AnimeListScreenProps,
  AnimeListScreenViewModel,
  AnimeStateSheetRequest,
  SeasonRatingSheetRequest,
} from "./anime-list-screen.types";
import type { SeasonRatingValue } from "../SeasonRatingSheet";

/**
 * Coordinates anime list screen state and actions. React Compiler memoizes this hook, so each handler
 * keeps its identity while its inputs do; the sheet handlers read the list when they run instead of
 * closing over it, so a database write does not hand every card new callbacks.
 */
export function useAnimeListScreen(
  _props: AnimeListScreenProps,
): AnimeListScreenViewModel {
  // 1. Refs
  const hasUserSelectedFilterRef = useRef(false);
  // The list as of the last commit, read by the sheet handlers when a card opens a sheet.
  const animesRef = useRef<readonly AnimeListItem[]>([]);

  // 2. State
  // The bridge config is a live query that has not answered on the first render, so the initial
  // filter assumes season mode off; the soft-follow effect below moves it once the row is read.
  const [selectedFilter, setSelectedFilter] = useState<AnimeDayFilter>(() =>
    getDefaultAnimeDayFilter(new Date(), false),
  );
  // Today's filter as of mount, for the filter rail's "today" marker.
  const [today] = useState(() => getDefaultAnimeDayFilter(new Date()));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stateSheetRequest, setStateSheetRequest] =
    useState<AnimeStateSheetRequest | null>(null);
  const [seasonRatingSheetRequest, setSeasonRatingSheetRequest] =
    useState<SeasonRatingSheetRequest | null>(null);
  const [isSyncSheetOpen, setIsSyncSheetOpen] = useState(false);

  // 3. Context/3rd Party Hooks
  const router = useRouter();
  const { toast } = useToast();
  const { isDark } = useAppTheme();
  const [themeColorForeground] = useThemeColor(["foreground"]);
  const { layout: layoutMode, width: frameWidth } = useResponsiveLayout();
  const headerHeight = useHeaderHeight();
  const networkState = useNetworkState();

  // 4. Queries/Mutations
  const { data: animes, allActiveAnimes } = useAnimeList(selectedFilter);
  const { capPlus, capMinus, capPlusHalf, capMinusHalf, setEstado } =
    useMutateAnime();
  const { submitSeasonRatingIntent } = useSeasonRatingIntent();
  const { config, isConfigured } = useBridgeConfig();
  const { connectionStatus, lastSyncAt, manualSync, pendingOpsCount } =
    useSyncFacade();

  // 5. Derived State
  // The user's diagnostics switch, derived from the pairing row the query above already holds:
  // no second read, and the tap boundary sees exactly what Settings wrote.
  const isTelemetryEnabled = isSyncTelemetryEnabled(config);
  // Season mode is the last reconcile's `season_mode` (whether the bridge has a season open),
  // read from the pairing row the query above already holds.
  const seasonMode = config?.seasonMode === true;
  const filterOptions = ANIME_DAY_FILTER_OPTIONS;
  const isEmpty = animes.length === 0;
  const selectedFilterOption = getAnimeDayFilterOption(selectedFilter);
  const settingsHref = "/(tabs)/settings" satisfies Href;
  let isDeviceOnline: boolean | null = null;
  if (typeof networkState.isInternetReachable === "boolean") {
    isDeviceOnline = networkState.isInternetReachable;
  } else if (typeof networkState.isConnected === "boolean") {
    isDeviceOnline = networkState.isConnected;
  }
  const filterCounts = computeFilterCounts(allActiveAnimes ?? []);
  const contextualHeader = buildContextualHeader(selectedFilter, animes.length, new Date());
  const syncFacts = {
    connectionStatus,
    isBridgeConfigured: isConfigured,
    isDeviceOnline,
    lastSyncAt,
    pendingOpsCount,
  };
  const syncStatus = deriveVisibleSyncStatus(syncFacts, new Date());
  const headerLayout = deriveHeaderLayout(layoutMode, frameWidth);
  const bodyStyle = useMemo(() => ({ paddingTop: headerHeight }), [headerHeight]);
  const isManualSyncEnabled = deriveManualSyncEnabled({ ...syncFacts, isRefreshing });

  // 6. Callbacks (calling pure helpers)
  const handleSelectedFilterChange = (filter: AnimeDayFilter) => {
    hasUserSelectedFilterRef.current = true;
    setSelectedFilter(filter);
  };

  const handleRefresh = async () => {
    if (!isManualSyncEnabled) {
      return;
    }

    await runManualRefresh({ manualSync, setIsRefreshing, syncFacts, toast });
  };

  // The telemetry boundary and the failure toast live in the module-level runner.
  // `isTelemetryEnabled` is load-bearing: this callback closes over the resolved switch, so a tap
  // made after the user turned telemetry off is never recorded by a stale closure.
  const runMutation = (
    animeId: string,
    actionLabel: ChapterActionLabel,
    action: AnimeListScreenChapterActionRunner,
  ) =>
    runChapterMutation(animeId, actionLabel, action, {
      isTelemetryEnabled,
      toast,
    });

  const handleCapPlus = (animeId: string) => runMutation(animeId, "capPlus", capPlus);

  const handleCapMinus = (animeId: string) => runMutation(animeId, "capMinus", capMinus);

  const handleCapPlusHalf = (animeId: string) =>
    runMutation(animeId, "capPlusHalf", capPlusHalf);

  const handleCapMinusHalf = (animeId: string) =>
    runMutation(animeId, "capMinusHalf", capMinusHalf);

  const handleOpenStateSheet = (animeId: string, currentEstado: number) => {
    const anime = animesRef.current.find((currentAnime) => currentAnime._id === animeId);
    setStateSheetRequest({ animeId, currentEstado, animeTitle: anime?.nombre ?? '' });
  };

  const handleCloseStateSheet = () => {
    setStateSheetRequest(null);
  };

  const handleOpenSeasonRatingSheet = (animeId: string) => {
    const anime = animesRef.current.find((currentAnime) => currentAnime._id === animeId);
    const seasonProjection = anime?.seasonProjection ?? null;
    if (!anime || !seasonProjection) {
      return;
    }

    setSeasonRatingSheetRequest({
      animeId,
      seasonId: seasonProjection.seasonId,
      animeTitle: anime.nombre,
      bridgeRating: seasonProjection.bridgeRating,
      pendingRating: seasonProjection.localIntent?.nota ?? null,
    });
  };

  const handleCloseSeasonRatingSheet = () => {
    setSeasonRatingSheetRequest(null);
  };

  const handleStateSheetSelect = async (estado: number) => {
    const request = stateSheetRequest;
    if (!request) {
      return;
    }
    setStateSheetRequest(null);
    try {
      await setEstado(request.animeId, estado);
    } catch (error) {
      // Same door as a chapter change: an escaping rejection would be unhandled, and the sheet is
      // already closed, so the user would see nothing at all.
      console.warn('[AnimeListScreen] State selection failed:', error);
      toast.show({
        variant: 'danger',
        label: buildAnimeMutationFailureFeedback(error).label,
        description: buildAnimeMutationFailureFeedback(error).description,
        duration: 4000,
      });
    }
  };

  const handleSeasonRatingSubmit = async (rating: SeasonRatingValue) => {
    const request = seasonRatingSheetRequest;
    if (!request) {
      return;
    }

    try {
      await submitSeasonRatingIntent(
        { animeId: request.animeId, seasonId: request.seasonId },
        rating,
      );
      setSeasonRatingSheetRequest(null);
    } catch (error) {
      // The note takes the same door as a chapter change: recorded, narrated, and the sheet stays
      // open because nothing was stored.
      console.warn('[AnimeListScreen] Season rating submit failed:', error);
      const feedback = buildAnimeMutationFailureFeedback(error);
      toast.show({
        variant: 'danger',
        label: feedback.label,
        description: feedback.description,
        duration: 4000,
      });
    }
  };

  const handleOpenSettings = () => {
    router.push(settingsHref);
  };

  const handleRefreshPress = () => {
    void handleRefresh();
  };

  const handleOpenSyncSheet = () => {
    setIsSyncSheetOpen(true);
  };

  const handleCloseSyncSheet = () => {
    setIsSyncSheetOpen(false);
  };

  // 7. Effects
  useEffect(() => {
    animesRef.current = animes;
  }, [animes]);

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
    headerLayout,
    bodyStyle,
    isDark,
    isEmpty,
    isRefreshing,
    isManualSyncEnabled,
    isSyncSheetOpen,
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
    handleCloseSyncSheet,
    handleOpenSettings,
    handleOpenSyncSheet,
    handleOpenSeasonRatingSheet,
    handleOpenStateSheet,
    handleRefresh,
    handleRefreshPress,
    handleSelectedFilterChange,
    handleSeasonRatingSubmit,
    handleStateSheetSelect,
  };
}
