import { act, renderHook } from '@testing-library/react-native';
import { useAnimeListScreen } from '../../../../src/features/animes/ui/AnimeListScreen/use-anime-list-screen';
import { buildSeasonAwareAnimeListItem } from './use-anime-list-screen-season-rating.helpers';

/** The bridge config row the mocked live query answers; each test sets its own season mode. */
let mockBridgeConfig: { deviceId: string; seasonMode: boolean } | null = null;

jest.mock('expo-network', () => ({
  useNetworkState: () => ({ isInternetReachable: true, isConnected: true }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('heroui-native', () => ({
  useThemeColor: () => ['#000000'],
  useToast: () => ({ toast: { show: jest.fn() } }),
}));

jest.mock('../../../../src/contexts/app-theme-context', () => ({
  useAppTheme: () => ({ isDark: false }),
}));

jest.mock('../../../../src/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: () => ({ layout: 'phone', width: 412 }),
}));

jest.mock('../../../../src/features/settings/use-bridge-config', () => ({
  useBridgeConfig: () => ({ config: mockBridgeConfig, isConfigured: mockBridgeConfig !== null }),
}));

jest.mock('../../../../src/features/sync/use-sync-facade', () => ({
  useSyncFacade: () => ({
    connectionStatus: 'idle',
    lastSyncAt: null,
    manualSync: jest.fn(),
    pendingOpsCount: 0,
  }),
}));

jest.mock('../../../../src/features/animes/use-anime-list', () => ({
  useAnimeList: jest.fn(),
}));

jest.mock('../../../../src/features/animes/use-mutate-anime', () => ({
  useMutateAnime: () => ({
    capPlus: jest.fn(),
    capMinus: jest.fn(),
    capPlusHalf: jest.fn(),
    capMinusHalf: jest.fn(),
    setEstado: jest.fn(),
  }),
}));

jest.mock('../../../../src/features/animes/use-season-rating-intent', () => ({
  useSeasonRatingIntent: jest.fn(),
}));

/** Makes the mocked list answer exactly `items`. */
function mockAnimeList(items: readonly object[]): void {
  const { useAnimeList } = jest.requireMock('../../../../src/features/animes/use-anime-list');
  useAnimeList.mockReturnValue({ data: items, allActiveAnimes: items });
}

/** The `submitSeasonRatingIntent` the screen received from the mocked rating hook. */
function submittedRatings(): jest.Mock {
  const { useSeasonRatingIntent } = jest.requireMock('../../../../src/features/animes/use-season-rating-intent');

  return useSeasonRatingIntent.mock.results[0].value.submitSeasonRatingIntent as jest.Mock;
}

describe('useAnimeListScreen season rating integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBridgeConfig = { deviceId: 'bridge-1', seasonMode: true };
    const { useSeasonRatingIntent } = jest.requireMock(
      '../../../../src/features/animes/use-season-rating-intent',
    );
    mockAnimeList([buildSeasonAwareAnimeListItem()]);
    useSeasonRatingIntent.mockReturnValue({
      submitSeasonRatingIntent: jest.fn(),
    });
  });

  it('opens season rating sheet with pending local truth and the season of the anime', () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleOpenSeasonRatingSheet('anime-1');
    });

    expect(result.current.seasonRatingSheetRequest).toEqual({
      animeId: 'anime-1',
      seasonId: 'season-2026-q3',
      animeTitle: 'Blue Box',
      bridgeRating: 4,
      pendingRating: 6,
    });
  });

  it('opens season rating sheet for an ungraded candidate', () => {
    mockAnimeList([
      {
        ...buildSeasonAwareAnimeListItem(),
        seasonProjection: { seasonId: 'season-2026-q4', bridgeRating: null, localIntent: null },
      },
    ]);

    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleOpenSeasonRatingSheet('anime-1');
    });

    expect(result.current.seasonRatingSheetRequest).toEqual({
      animeId: 'anime-1',
      seasonId: 'season-2026-q4',
      animeTitle: 'Blue Box',
      bridgeRating: null,
      pendingRating: null,
    });
  });

  it('submits the rating for the season of the rated anime', async () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleOpenSeasonRatingSheet('anime-1');
    });

    await act(async () => {
      await result.current.handleSeasonRatingSubmit(5);
    });

    expect(submittedRatings()).toHaveBeenCalledWith({ animeId: 'anime-1', seasonId: 'season-2026-q3' }, 5);
    expect(result.current.seasonRatingSheetRequest).toBeNull();
  });

  it('never rates an anime that is not a season candidate', async () => {
    mockAnimeList([{ ...buildSeasonAwareAnimeListItem(), seasonProjection: null }]);
    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleOpenSeasonRatingSheet('anime-1');
    });
    await act(async () => {
      await result.current.handleSeasonRatingSubmit(5);
    });

    expect(result.current.seasonRatingSheetRequest).toBeNull();
    expect(submittedRatings()).not.toHaveBeenCalled();
  });

  it('follows bridge_config.season_mode: on shows Ver hoy, and switching it off follows while the user has not picked', () => {
    const { result, rerender } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.isSeasonMode).toBe(true);
    expect(result.current.selectedFilter).toBe('Ver hoy');

    mockBridgeConfig = { deviceId: 'bridge-1', seasonMode: false };
    rerender({});

    expect(result.current.isSeasonMode).toBe(false);
    expect(result.current.selectedFilter).not.toBe('Ver hoy');
  });

  it('reads season mode off when the bridge config row has not been read', () => {
    mockBridgeConfig = null;

    const { result } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.isSeasonMode).toBe(false);
    expect(result.current.selectedFilter).not.toBe('Ver hoy');
  });

  it('stops following season mode once the user picked a filter', () => {
    const { result, rerender } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleSelectedFilterChange('Visto');
    });
    mockBridgeConfig = { deviceId: 'bridge-1', seasonMode: false };
    rerender({});

    expect(result.current.isSeasonMode).toBe(false);
    expect(result.current.selectedFilter).toBe('Visto');
  });
});
