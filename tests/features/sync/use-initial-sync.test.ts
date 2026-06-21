import {
  deleteAnimeLocally,
  initialSync,
  upsertAnimeFromBridge,
} from '../../../src/features/sync/use-initial-sync';
import { bridgeClient } from '../../../src/infrastructure/api';
import * as dbClient from '../../../src/infrastructure/db/client';
import * as initialSyncHelpers from '../../../src/features/sync/initial-sync.helpers';

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  withExclusiveWrite: jest.fn().mockResolvedValue(undefined),
  withDeferredWrite: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: { getAnime: jest.fn() },
}));

jest.mock('../../../src/infrastructure/db/anime-repository', () => ({
  upsertAnime: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/infrastructure/validation/anime-schema', () => ({
  AnimeSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
}));

jest.mock('../../../src/features/sync/initial-sync.helpers', () => ({
  fetchInitialSyncSnapshot: jest.fn(),
  persistInitialSyncSnapshot: jest.fn(),
}));

describe('initialSync', () => {
  const rawDb = { name: 'raw-db' };

  beforeEach(() => {
    jest.clearAllMocks();
    (initialSyncHelpers.fetchInitialSyncSnapshot as jest.Mock).mockResolvedValue([]);
    (initialSyncHelpers.persistInitialSyncSnapshot as jest.Mock).mockResolvedValue(0);
  });

  it('hydrates the first anime snapshot from the persisted bridge config', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      id: 1,
      ip: '192.168.1.10',
      port: 8080,
      token: 'auth-secret',
    });
    (initialSyncHelpers.fetchInitialSyncSnapshot as jest.Mock).mockResolvedValue([
      { _id: 'anime-1' },
    ]);
    (initialSyncHelpers.persistInitialSyncSnapshot as jest.Mock).mockResolvedValue(1);

    const result = await initialSync(rawDb as never);

    expect(initialSyncHelpers.fetchInitialSyncSnapshot).toHaveBeenCalledWith({
      ip: '192.168.1.10',
      port: 8080,
      token: 'auth-secret',
    });
    expect(initialSyncHelpers.persistInitialSyncSnapshot).toHaveBeenCalledWith(rawDb, [
      { _id: 'anime-1' },
    ]);
    expect(result).toBe(1);
  });

  it('rejects initial sync when bridge config is incomplete', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue(null);

    await expect(initialSync(rawDb as never)).rejects.toThrow(
      'Bridge config is missing or incomplete',
    );
    expect(initialSyncHelpers.fetchInitialSyncSnapshot).not.toHaveBeenCalled();
  });
});

describe('realtime anime writes stay reactive for useLiveQuery', () => {
  const rawDb = { name: 'raw-db' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('upsertAnimeFromBridge writes through the shared reactive connection (withDeferredWrite)', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      id: 1,
      ip: '192.168.1.10',
      port: 8080,
      token: 'auth-secret',
    });
    (bridgeClient.getAnime as jest.Mock).mockResolvedValue({
      ok: true,
      data: { _id: 'anime-1' },
    });

    await upsertAnimeFromBridge(rawDb as never, 'anime-1');

    expect(dbClient.withDeferredWrite).toHaveBeenCalledWith(rawDb, expect.any(Function));
    expect(dbClient.withExclusiveWrite).not.toHaveBeenCalled();
  });

  it('deleteAnimeLocally writes through the shared reactive connection (withDeferredWrite)', async () => {
    await deleteAnimeLocally(rawDb as never, 'anime-1');

    expect(dbClient.withDeferredWrite).toHaveBeenCalledWith(rawDb, expect.any(Function));
    expect(dbClient.withExclusiveWrite).not.toHaveBeenCalled();
  });
});
