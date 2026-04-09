import { incrementalSync } from '../../../src/features/sync/use-initial-sync';
import * as dbClient from '../../../src/infrastructure/db/client';

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  withExclusiveWrite: jest.fn(),
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
