import { renderHook, waitFor } from '@testing-library/react-native';
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
  const rawDb = { id: 'raw-db' } as never;
  const getActiveSeasonMock = bridgeClient.getActiveSeason as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    useActiveSeasonStore.setState({ activeSeasonSnapshot: null });
    (useOptionalSQLiteContext as jest.Mock).mockReturnValue(rawDb);
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

  it('stays idle and does not call the bridge adapter when sync is disabled', () => {
    renderHook(() => useSeasonSync({ enabled: false }));

    expect(getActiveSeasonMock).not.toHaveBeenCalled();
  });
});
