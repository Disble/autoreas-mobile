import * as animeRepository from '../../../src/infrastructure/db/anime-repository';
import { withLocalWrite } from '../../../src/infrastructure/db/client/client.helpers';
import { bridgeConfig } from '../../../src/infrastructure/db/schema';
import { bridgeClient } from '../../../src/infrastructure/api';
import {
  fetchInitialSyncSnapshot,
  persistInitialSyncSnapshot,
  persistPairedBridgeConfiguration,
} from '../../../src/features/sync/initial-sync.helpers';

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: {
    listAnimes: jest.fn(),
  },
}));

jest.mock('../../../src/infrastructure/db/anime-repository', () => ({
  upsertAnime: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  withLocalWrite: jest.fn(),
}));

describe('initial-sync helpers', () => {
  const rawDb = { id: 'raw-db' };
  const animeSnapshot = [
    {
      id: 'anime-1',
      name: 'One Piece',
      status: 0,
      episodesWatched: 12,
      totalEpisodes: null,
      days: [],
      genres: [],
      kind: null,
      active: 1,
      firstCycle: 0,
      lastWatchedAt: 1710000000000,
      premieredAt: null,
      createdAt: null,
      deletedAt: null,
      cover: null,
      sourceUrl: null,
      folder: null,
      studios: null,
      origin: null,
      durationMinutes: null,
      modified_at: 0,
    },
  ];
  const normalizedAnimeSnapshot = [
    {
      _id: 'anime-1',
      nombre: 'One Piece',
      estado: 0,
      nrocapvisto: 12,
      totalcap: null,
      dias: [],
      generos: [],
      tipo: null,
      activo: 1,
      primeravez: 0,
      fechaUltCapVisto: 1710000000000,
      fechaEstreno: null,
      fechaCreacion: null,
      fechaEliminacion: null,
      portada: null,
      pagina: null,
      carpeta: null,
      estudios: null,
      origen: null,
      duracion: null,
    },
  ];
  const ingestedAnimeSnapshot = [
    { anime: normalizedAnimeSnapshot[0], bridgeModifiedAt: 0 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches the initial bridge snapshot through the bridge client with staged credentials', async () => {
    (bridgeClient.listAnimes as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      data: animeSnapshot,
      rawBody: JSON.stringify(animeSnapshot),
      url: 'https://192.168.1.10:9876/api/animes',
    });

    const result = await fetchInitialSyncSnapshot({
      ip: '192.168.1.10',
      port: 9876,
      token: 'auth-secret',
    });

    expect(bridgeClient.listAnimes).toHaveBeenCalledWith({
      ip: '192.168.1.10',
      port: 9876,
      token: 'auth-secret',
    });
    expect(result).toEqual(ingestedAnimeSnapshot);
  });

  it('falla fuerte cuando el bridge responde un snapshot inválido en inglés', async () => {
    (bridgeClient.listAnimes as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ id: 'anime-1', name: 'One Piece', status: 0, episodesWatched: '12' }],
      rawBody: '[]',
      url: 'https://192.168.1.10:9876/api/animes',
    });

    await expect(
      fetchInitialSyncSnapshot({
        ip: '192.168.1.10',
        port: 9876,
        token: 'auth-secret',
      })
    ).rejects.toThrow('Invalid anime list from bridge');
  });

  it('persists fetched anime rows through the deferred write so live queries can observe it', async () => {
    (withLocalWrite as jest.Mock).mockImplementation(async (_db, task) => {
      await task({}, {});
    });

    const count = await persistInitialSyncSnapshot(rawDb as never, ingestedAnimeSnapshot);

    expect(count).toBe(1);
    expect(withLocalWrite).toHaveBeenCalledTimes(1);
    expect(animeRepository.upsertAnime).toHaveBeenCalledWith(
      {},
      normalizedAnimeSnapshot[0],
      undefined,
      0,
    );
  });

  it('commits bridge config and snapshot together in one deferred write so live queries can observe it', async () => {
    const deleteMock = jest.fn().mockResolvedValue(undefined);
    const valuesMock = jest.fn().mockResolvedValue(undefined);
    const insertMock = jest.fn().mockReturnValue({ values: valuesMock });

    (withLocalWrite as jest.Mock).mockImplementation(async (_db, task) => {
      await task(
        {
          delete: deleteMock,
          insert: insertMock,
        },
        {},
      );
    });

    const count = await persistPairedBridgeConfiguration(
      rawDb as never,
      {
        ip: '192.168.1.10',
        port: 9876,
        token: 'auth-secret',
        deviceId: 'device-1',
        deviceName: 'Bridge Casa',
      },
      ingestedAnimeSnapshot,
    );

    expect(count).toBe(1);
    expect(withLocalWrite).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith(bridgeConfig);
    expect(insertMock).toHaveBeenCalledWith(bridgeConfig);
    expect(valuesMock).toHaveBeenCalledWith({
      ip: '192.168.1.10',
      port: 9876,
      token: 'auth-secret',
      deviceId: 'device-1',
      deviceName: 'Bridge Casa',
    });
    expect(animeRepository.upsertAnime).toHaveBeenCalledWith(
      expect.objectContaining({ delete: deleteMock, insert: insertMock }),
      normalizedAnimeSnapshot[0],
      undefined,
      0,
    );
  });
});
