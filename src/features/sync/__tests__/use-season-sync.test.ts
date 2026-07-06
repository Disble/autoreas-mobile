import { renderHook, waitFor } from '@testing-library/react-native';
import { bridgeClient } from '../../../infrastructure/api';
import { getBridgeConfigSnapshot } from '../../../infrastructure/db/client';
import { useOptionalSQLiteContext } from '../../../infrastructure/db/native-runtime';
import { useActiveSeasonStore } from '../../../infrastructure/store/active-season-store';
import { useSeasonSync } from '../use-season-sync';

jest.mock('../../../infrastructure/api', () => ({
  bridgeClient: {
    getActiveSeason: jest.fn(),
  },
}));

jest.mock('../../../infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
}));

jest.mock('../../../infrastructure/db/native-runtime', () => ({
  useOptionalSQLiteContext: jest.fn(),
}));

describe('useSeasonSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useActiveSeasonStore.setState({ activeSeasonSnapshot: null });
  });

  it('hydrates the active-season store from the bridge snapshot when enabled', async () => {
    (useOptionalSQLiteContext as jest.Mock).mockReturnValue({ id: 'raw-db' });
    (getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '127.0.0.1',
      port: 8080,
      token: 'bridge-token',
    });
    (bridgeClient.getActiveSeason as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        season_id: 'season-2026-q3',
        candidates: [
          {
            anime_id: 'anime-1',
            nota_estreno: 5,
            nota_source: 'bridge',
          },
        ],
      },
      rawBody: '{"season_id":"season-2026-q3"}',
      url: 'http://127.0.0.1:8080/api/seasons/active',
    });

    const { result } = renderHook(() => useSeasonSync({ enabled: true }));

    await waitFor(() => {
      expect(useActiveSeasonStore.getState().activeSeasonSnapshot?.seasonId).toBe('season-2026-q3');
    });

    expect(result.current.isRefreshing).toBe(false);
    expect(bridgeClient.getActiveSeason).toHaveBeenCalledWith({
      ip: '127.0.0.1',
      port: 8080,
      token: 'bridge-token',
    });
  });

  it('clears the active-season store when bridge reports no active season', async () => {
    useActiveSeasonStore.setState({
      activeSeasonSnapshot: {
        seasonId: 'stale-season',
        candidates: [],
        candidatesByAnimeId: {},
      },
    });
    (useOptionalSQLiteContext as jest.Mock).mockReturnValue({ id: 'raw-db' });
    (getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '127.0.0.1',
      port: 8080,
      token: 'bridge-token',
    });
    (bridgeClient.getActiveSeason as jest.Mock).mockResolvedValue({
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

  it('stays idle when the hook is disabled', async () => {
    (useOptionalSQLiteContext as jest.Mock).mockReturnValue({ id: 'raw-db' });

    renderHook(() => useSeasonSync({ enabled: false }));

    await waitFor(() => {
      expect(bridgeClient.getActiveSeason).not.toHaveBeenCalled();
    });
  });
});
