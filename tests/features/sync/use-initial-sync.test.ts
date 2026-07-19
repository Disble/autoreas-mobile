import * as useInitialSync from '../../../src/features/sync/use-initial-sync';
import { initialSync } from '../../../src/features/sync/use-initial-sync';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as initialSyncHelpers from '../../../src/features/sync/initial-sync.helpers';

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
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

describe('the WS GET-then-clobber writer no longer exists', () => {
  it('does not export upsertAnimeFromBridge (removed in favor of routing through reconcile)', () => {
    expect((useInitialSync as Record<string, unknown>).upsertAnimeFromBridge).toBeUndefined();
  });

  it('does not export deleteAnimeLocally (now unused after the WS reroute to reconcile)', () => {
    expect((useInitialSync as Record<string, unknown>).deleteAnimeLocally).toBeUndefined();
  });

  it('does not export fetchAnimeById (only used by the removed clobber writer)', () => {
    expect((useInitialSync as Record<string, unknown>).fetchAnimeById).toBeUndefined();
  });
});
