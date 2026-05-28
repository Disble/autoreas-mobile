import {
  initialSync,
  incrementalSync,
} from '../../../src/features/sync/use-initial-sync';
import * as dbClient from '../../../src/infrastructure/db/client';
import * as initialSyncHelpers from '../../../src/features/sync/initial-sync.helpers';

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  withExclusiveWrite: jest.fn(),
}));

jest.mock('../../../src/features/sync/initial-sync.helpers', () => ({
  fetchInitialSyncSnapshot: jest.fn(),
  persistInitialSyncSnapshot: jest.fn(),
}));

describe('incrementalSync', () => {
  const rawDb = { name: 'raw-db' };
  let mockDb: any;
  let mockUpdateSet: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockUpdateSet = jest.fn().mockReturnValue({ where: jest.fn() });
    mockDb = {
      delete: jest.fn().mockReturnValue({ where: jest.fn() }),
      update: jest.fn().mockReturnValue({ set: mockUpdateSet }),
    };

    (dbClient.withExclusiveWrite as jest.Mock).mockImplementation(async (_db, task) => {
      return task(mockDb);
    });

    global.fetch = jest.fn();
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

  it('usa el lastChangelogId persistido cuando no recibe since explícito', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      id: 1,
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      lastChangelogId: 12,
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ changes: [], last_changelog_id: 15 }),
    });

    const result = await incrementalSync(rawDb as never);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.10:8080/api/animes/changes?since=12',
      expect.any(Object),
    );
    expect(result).toBe(15);
    expect(mockUpdateSet).toHaveBeenCalledWith({ lastChangelogId: 15 });
  });

  it('respeta since explícito pero persiste el cursor más nuevo devuelto por bridge', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      id: 1,
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      lastChangelogId: 12,
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ changes: [], last_changelog_id: 18 }),
    });

    await incrementalSync(rawDb as never, 0);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.10:8080/api/animes/changes?since=0',
      expect.any(Object),
    );
    expect(mockUpdateSet).toHaveBeenCalledWith({ lastChangelogId: 18 });
  });
});
