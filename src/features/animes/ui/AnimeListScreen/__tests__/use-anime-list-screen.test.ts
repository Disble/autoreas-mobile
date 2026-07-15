import { act, renderHook } from "@testing-library/react-native";
import { LOCAL_ACTIVE_SEASON_ID } from "../../../anime-season.constants";
import { useAnimeListScreen } from "../use-anime-list-screen";
import { buildSeasonAwareAnimeListItem } from "./use-anime-list-screen.helpers";

jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isInternetReachable: true, isConnected: true }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("heroui-native", () => ({
  useThemeColor: () => ["#000000"],
  useToast: () => ({ toast: { show: jest.fn() } }),
}));

jest.mock("../../../../../contexts/app-theme-context", () => ({
  useAppTheme: () => ({ isDark: false }),
}));

jest.mock("../../../../../hooks/use-responsive-layout", () => ({
  useResponsiveLayout: () => ({ layout: "phone" }),
}));

jest.mock("../../../../../infrastructure/store/season-mode-store", () => ({
  useSeasonModeStore: Object.assign(
    (selector: (state: { seasonMode: boolean }) => unknown) =>
      selector({ seasonMode: true }),
    {
      getState: () => ({ seasonMode: true }),
    },
  ),
}));

jest.mock("../../../../settings/use-bridge-config", () => ({
  useBridgeConfig: () => ({ isConfigured: true }),
}));

jest.mock("../../../../sync/use-sync-facade", () => ({
  useSyncFacade: () => ({
    connectionStatus: "idle",
    lastSyncAt: null,
    manualSync: jest.fn(),
    pendingOpsCount: 0,
    syncError: null,
  }),
}));

jest.mock("../../../use-anime-list", () => ({
  useAnimeList: jest.fn(),
}));

jest.mock("../../../use-mutate-anime", () => ({
  useMutateAnime: () => ({
    capPlus: jest.fn(),
    capMinus: jest.fn(),
    capPlusHalf: jest.fn(),
    capMinusHalf: jest.fn(),
    setEstado: jest.fn(),
  }),
}));

jest.mock("../../../use-season-rating-intent", () => ({
  useSeasonRatingIntent: jest.fn(),
}));

describe("useAnimeListScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { useAnimeList } = jest.requireMock("../../../use-anime-list");
    const { useSeasonRatingIntent } = jest.requireMock(
      "../../../use-season-rating-intent",
    );
    useAnimeList.mockReturnValue({
      data: [buildSeasonAwareAnimeListItem()],
      allActiveAnimes: [buildSeasonAwareAnimeListItem()],
    });
    useSeasonRatingIntent.mockReturnValue({
      submitSeasonRatingIntent: jest.fn(),
    });
  });

  it("opens season rating sheet with pending local truth", () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleOpenSeasonRatingSheet("anime-1");
    });

    expect(result.current.seasonRatingSheetRequest).toEqual({
      animeId: "anime-1",
      animeTitle: "Blue Box",
      bridgeRating: 4,
      pendingRating: 6,
      pendingStatus: "pending",
      pendingFailureKind: null,
    });
  });

  it("opens season rating sheet for the local active fallback projection", () => {
    const fallbackAnime = {
      ...buildSeasonAwareAnimeListItem(),
      seasonProjection: {
        seasonId: LOCAL_ACTIVE_SEASON_ID,
        bridgeRating: null,
        bridgeRatingSource: null,
        localIntent: null,
      },
    };
    const { useAnimeList } = jest.requireMock("../../../use-anime-list");
    useAnimeList.mockReturnValue({
      data: [fallbackAnime],
      allActiveAnimes: [fallbackAnime],
    });

    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleOpenSeasonRatingSheet("anime-1");
    });

    expect(result.current.seasonRatingSheetRequest).toEqual({
      animeId: "anime-1",
      animeTitle: "Blue Box",
      bridgeRating: null,
      pendingRating: null,
      pendingStatus: null,
      pendingFailureKind: null,
    });
  });

  it("submits season rating through the feature seam", async () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleOpenSeasonRatingSheet("anime-1");
    });

    await act(async () => {
      await result.current.handleSeasonRatingSubmit(5);
    });

    const { useSeasonRatingIntent } = jest.requireMock(
      "../../../use-season-rating-intent",
    );
    const submitSeasonRatingIntent = useSeasonRatingIntent.mock.results[0].value
      .submitSeasonRatingIntent as jest.Mock;

    expect(submitSeasonRatingIntent).toHaveBeenCalledWith("anime-1", 5);
    expect(result.current.seasonRatingSheetRequest).toBeNull();
  });
});
