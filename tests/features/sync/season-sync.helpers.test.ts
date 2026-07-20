import { bridgeClient } from '../../../src/infrastructure/api';
import { getBridgeConfigSnapshot } from '../../../src/infrastructure/db/client/client.helpers';
import {
  fetchActiveSeasonFromBridge,
  readCachedActiveSeasonSnapshot,
  writeCachedActiveSeasonSnapshot,
} from '../../../src/features/sync/season-sync.helpers';

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

  it('resolves a normalized snapshot from a valid grade/grade_source payload', async () => {
    getActiveSeasonMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        season_id: '2026-q3',
        candidates: [
          { anime_id: 'a1', grade: 5, grade_source: 'bridge' },
          { anime_id: 'a2', grade: null },
        ],
      },
      rawBody: null,
      url: 'http://127.0.0.1:8080/api/seasons/active',
    });

    await expect(fetchActiveSeasonFromBridge(rawDb)).resolves.toMatchObject({
      seasonId: '2026-q3',
      candidates: [
        { animeId: 'a1', bridgeRating: 5, bridgeRatingSource: 'bridge' },
        { animeId: 'a2', bridgeRating: null, bridgeRatingSource: null },
      ],
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

describe('active season cache', () => {
  const rawDb = {
    getFirstAsync: jest.fn(),
    runAsync: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restores normalized candidate membership from the durable cache', async () => {
    (rawDb.getFirstAsync as jest.Mock).mockResolvedValue({
      season_id: '2026-q3',
      candidates_json: JSON.stringify([
        { anime_id: 'a1', grade: 5, grade_source: 'bridge' },
        { anime_id: 'a2', grade: null, grade_source: null },
      ]),
    });

    await expect(readCachedActiveSeasonSnapshot(rawDb as never)).resolves.toMatchObject({
      seasonId: '2026-q3',
      candidatesByAnimeId: {
        a1: { animeId: 'a1', bridgeRating: 5, bridgeRatingSource: 'bridge' },
        a2: { animeId: 'a2', bridgeRating: null, bridgeRatingSource: null },
      },
    });
  });

  it('writes the bridge-owned candidate membership for future offline startup', async () => {
    (rawDb.runAsync as jest.Mock).mockResolvedValue(undefined);

    await writeCachedActiveSeasonSnapshot(rawDb as never, {
      seasonId: '2026-q3',
      candidates: [
        { animeId: 'a1', bridgeRating: 5, bridgeRatingSource: 'bridge' },
      ],
      candidatesByAnimeId: {},
    });

    expect(rawDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO active_season_cache'),
      '2026-q3',
      JSON.stringify([{ anime_id: 'a1', grade: 5, grade_source: 'bridge' }]),
    );
  });
});
