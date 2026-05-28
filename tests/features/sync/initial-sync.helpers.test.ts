import * as animeRepository from '../../../src/infrastructure/db/anime-repository';
import { withDeferredWrite } from '../../../src/infrastructure/db/client';
import { withExclusiveWrite } from '../../../src/infrastructure/db/client';
import { bridgeConfig } from '../../../src/infrastructure/db/schema';
import {
  fetchInitialSyncSnapshot,
  persistInitialSyncSnapshot,
  persistPairedBridgeConfiguration,
} from '../../../src/features/sync/initial-sync.helpers';

jest.mock('../../../src/infrastructure/db/anime-repository', () => ({
  upsertAnime: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  withDeferredWrite: jest.fn(),
  withExclusiveWrite: jest.fn(),
}));

describe('initial-sync helpers', () => {
  const rawDb = { id: 'raw-db' };
  const animeSnapshot = [
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
      fechaUltCapVisto: null,
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

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('fetches the initial bridge snapshot with the staged auth token', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => animeSnapshot,
    });

    const result = await fetchInitialSyncSnapshot({
      ip: '192.168.1.10',
      port: 8080,
      token: 'auth-secret',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.10:8080/api/animes',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer auth-secret',
        },
      },
    );
    expect(result).toEqual(animeSnapshot);
  });

  it('persists fetched anime rows without touching bridge config', async () => {
    (withExclusiveWrite as jest.Mock).mockImplementation(async (_db, task) => {
      await task({}, {});
    });

    const count = await persistInitialSyncSnapshot(rawDb as never, animeSnapshot);

    expect(count).toBe(1);
    expect(withExclusiveWrite).toHaveBeenCalledTimes(1);
    expect(animeRepository.upsertAnime).toHaveBeenCalledWith({}, animeSnapshot[0]);
  });

  it('commits bridge config and snapshot together in one deferred write so live queries can observe it', async () => {
    const deleteMock = jest.fn().mockResolvedValue(undefined);
    const valuesMock = jest.fn().mockResolvedValue(undefined);
    const insertMock = jest.fn().mockReturnValue({ values: valuesMock });

    (withDeferredWrite as jest.Mock).mockImplementation(async (_db, task) => {
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
        port: 8080,
        token: 'auth-secret',
        deviceId: 'device-1',
        deviceName: 'Bridge Casa',
      },
      animeSnapshot,
    );

    expect(count).toBe(1);
    expect(withExclusiveWrite).not.toHaveBeenCalled();
    expect(withDeferredWrite).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith(bridgeConfig);
    expect(insertMock).toHaveBeenCalledWith(bridgeConfig);
    expect(valuesMock).toHaveBeenCalledWith({
      ip: '192.168.1.10',
      port: 8080,
      token: 'auth-secret',
      deviceId: 'device-1',
      deviceName: 'Bridge Casa',
    });
    expect(animeRepository.upsertAnime).toHaveBeenCalledWith(
      expect.objectContaining({ delete: deleteMock, insert: insertMock }),
      animeSnapshot[0],
    );
  });
});
