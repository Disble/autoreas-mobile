import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSeasonSync } from '../../../src/features/sync/use-season-sync';
import { bridgeClient } from '../../../src/infrastructure/api';
import { getBridgeConfigSnapshot } from '../../../src/infrastructure/db/client/client.helpers';
import { useOptionalSQLiteContext } from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import { useActiveSeasonStore } from '../../../src/infrastructure/store/active-season-store';

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: {
    getActiveSeason: jest.fn(),
  },
  extractActiveSeasonSnapshot: jest.requireActual(
    '../../../src/infrastructure/api/bridge-client/bridge-url.helpers',
  ).extractActiveSeasonSnapshot,
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalSQLiteContext: jest.fn(),
}));

describe('useSeasonSync', () => {
  const rawDb = {
    id: 'raw-db',
    getFirstAsync: jest.fn(),
    runAsync: jest.fn(),
  };
  const getActiveSeasonMock = bridgeClient.getActiveSeason as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    useActiveSeasonStore.setState({ activeSeasonSnapshot: null });
    (useOptionalSQLiteContext as jest.Mock).mockReturnValue(rawDb);
    (rawDb.getFirstAsync as jest.Mock).mockResolvedValue(null);
    (rawDb.runAsync as jest.Mock).mockResolvedValue(undefined);
    (getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '127.0.0.1',
      port: 8080,
      token: 'bridge-token',
    });
  });

  it('hydrates the active-season store for the returned anime identifier', async () => {
    getActiveSeasonMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        season_id: 'season-2026-q3',
        candidates: [{ anime_id: 'anime-1', grade: 5, grade_source: 'bridge' }],
      },
      rawBody: null,
      url: 'http://127.0.0.1:8080/api/seasons/active',
    });

    const { result } = renderHook(() => useSeasonSync({ enabled: true }));

    await waitFor(() => {
      expect(useActiveSeasonStore.getState().activeSeasonSnapshot).toMatchObject({
        seasonId: 'season-2026-q3',
        candidatesByAnimeId: {
          'anime-1': {
            animeId: 'anime-1',
            bridgeRating: 5,
            bridgeRatingSource: 'bridge',
          },
        },
      });
    });

    expect(result.current.isRefreshing).toBe(false);
    expect(getActiveSeasonMock).toHaveBeenCalledWith({
      ip: '127.0.0.1',
      port: 8080,
      token: 'bridge-token',
    });
  });

  it('enables season mode when the bridge confirms an active season', async () => {
    getActiveSeasonMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        season_id: 'season-2026-q3',
        candidates: [],
      },
      rawBody: null,
      url: 'http://127.0.0.1:8080/api/seasons/active',
    });

    renderHook(() => useSeasonSync({ enabled: true }));

    await waitFor(() => {
      expect(useActiveSeasonStore.getState().activeSeasonSnapshot).toMatchObject({
        seasonId: 'season-2026-q3',
      });
    });
  });

  it('clears stale active-season data when the bridge responds with 404', async () => {
    useActiveSeasonStore.setState({
      activeSeasonSnapshot: {
        seasonId: 'stale-season',
        candidates: [],
        candidatesByAnimeId: {},
      },
    });
    getActiveSeasonMock.mockResolvedValue({
      ok: false,
      status: 404,
      data: null,
      rawBody: null,
      url: 'http://127.0.0.1:8080/api/seasons/active',
    });

    renderHook(() => useSeasonSync({ enabled: true }));

    await waitFor(() => {
      expect(useActiveSeasonStore.getState().activeSeasonSnapshot).toBeNull();
    });
  });

  it('keeps cached candidate membership when the bridge is unreachable at startup', async () => {
    (rawDb.getFirstAsync as jest.Mock).mockResolvedValue({
      season_id: 'cached-season',
      candidates_json: JSON.stringify([
        { anime_id: 'anime-1', grade: 7, grade_source: 'bridge' },
      ]),
    });
    getActiveSeasonMock.mockRejectedValue(new Error('Network request failed'));

    renderHook(() => useSeasonSync({ enabled: true }));

    await waitFor(() => {
      expect(useActiveSeasonStore.getState().activeSeasonSnapshot).toMatchObject({
        seasonId: 'cached-season',
        candidatesByAnimeId: {
          'anime-1': {
            animeId: 'anime-1',
            bridgeRating: 7,
            bridgeRatingSource: 'bridge',
          },
        },
      });
    });
  });

  it('clears mode, candidate data, and the durable cache as one transition', async () => {
    useActiveSeasonStore.setState({
      activeSeasonSnapshot: {
        seasonId: 'active-season',
        candidates: [],
        candidatesByAnimeId: {},
      },
    });
    getActiveSeasonMock.mockRejectedValue(new Error('Network request failed'));

    const { result } = renderHook(() => useSeasonSync({ enabled: true }));

    await act(async () => {
      await result.current.clearActiveSeason();
    });

    expect(useActiveSeasonStore.getState().activeSeasonSnapshot).toBeNull();
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'DELETE FROM active_season_cache WHERE id = 1',
    );
  });

  it('does not resurrect season mode when an older refresh resolves after deactivation', async () => {
    let resolveActiveSeason: (value: unknown) => void = (_value) => undefined;
    const activeSeasonRequest = new Promise((resolve) => {
      resolveActiveSeason = resolve;
    });
    getActiveSeasonMock.mockReturnValue(activeSeasonRequest);

    const { result } = renderHook(() => useSeasonSync({ enabled: true }));

    await waitFor(() => {
      expect(getActiveSeasonMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.clearActiveSeason();
      resolveActiveSeason({
        ok: true,
        status: 200,
        data: {
          season_id: 'stale-season',
          candidates: [{ anime_id: 'anime-1' }],
        },
        rawBody: null,
        url: 'http://127.0.0.1:8080/api/seasons/active',
      });
      await activeSeasonRequest;
    });

    expect(useActiveSeasonStore.getState().activeSeasonSnapshot).toBeNull();
  });

  it('stays idle and does not call the bridge adapter when sync is disabled', () => {
    renderHook(() => useSeasonSync({ enabled: false }));

    expect(getActiveSeasonMock).not.toHaveBeenCalled();
  });
});
