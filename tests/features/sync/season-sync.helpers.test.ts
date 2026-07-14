import { bridgeClient } from '../../../src/infrastructure/api';
import { getBridgeConfigSnapshot } from '../../../src/infrastructure/db/client';
import { fetchActiveSeasonFromBridge } from '../../../src/features/sync/season-sync.helpers';

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: {
    getActiveSeason: jest.fn(),
  },
  extractActiveSeasonSnapshot: jest.requireActual(
    '../../../src/infrastructure/api/bridge-client/bridge-url.helpers',
  ).extractActiveSeasonSnapshot,
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
}));

describe('fetchActiveSeasonFromBridge', () => {
  const rawDb = { id: 'raw-db' } as never;
  const getActiveSeasonMock = bridgeClient.getActiveSeason as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '127.0.0.1',
      port: 8080,
      token: 'bridge-token',
    });
  });

  it('returns null only when the bridge reports no active season', async () => {
    getActiveSeasonMock.mockResolvedValue({
      ok: false,
      status: 404,
      data: null,
      rawBody: null,
      url: 'http://127.0.0.1:8080/api/seasons/active',
    });

    await expect(fetchActiveSeasonFromBridge(rawDb)).resolves.toBeNull();
  });

  it.each([401, 500])('throws a reachable typed sync error for HTTP %i', async (status) => {
    getActiveSeasonMock.mockResolvedValue({
      ok: false,
      status,
      data: { error: 'request failed' },
      rawBody: '{"error":"request failed"}',
      url: 'http://127.0.0.1:8080/api/seasons/active',
    });

    await expect(fetchActiveSeasonFromBridge(rawDb)).rejects.toMatchObject({
      name: 'ActiveSeasonSyncError',
      status,
      message: `Active season fetch failed: ${status}`,
    });
  });

  it('throws a reachable typed sync error for a malformed successful payload', async () => {
    getActiveSeasonMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { season_id: 123, candidates: 'not-an-array' },
      rawBody: '{"season_id":123,"candidates":"not-an-array"}',
      url: 'http://127.0.0.1:8080/api/seasons/active',
    });

    await expect(fetchActiveSeasonFromBridge(rawDb)).rejects.toMatchObject({
      name: 'ActiveSeasonSyncError',
      status: 200,
      message: 'Invalid active season response',
    });
  });
});
