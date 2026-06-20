import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import * as dbClient from '../../../src/infrastructure/db/client';

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
  openDatabaseSync: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  createDrizzleDb: jest.fn(),
  getBridgeConfigSnapshot: jest.fn(),
  withExclusiveWrite: jest.fn(),
}));

describe('syncPendingOperations', () => {
  let rawDb: {
    getAllAsync: jest.Mock<Promise<unknown[]>, [string, ...unknown[]]>;
  };
  let mockDb: {
    update: jest.Mock;
  };
  let mockUpdateSet: jest.Mock;
  let mockUpdateWhere: jest.Mock;
  let withExclusiveWriteCall: number;

  function buildPendingOp(overrides: Partial<{
    id: number;
    animeId: string;
    operation: string;
    payload: string;
    status: string;
    createdAt: number;
  }> = {}) {
    return {
      id: 1,
      animeId: 'anime1',
      operation: 'update',
      payload: JSON.stringify({ nrocapvisto: 5 }),
      status: 'pending',
      createdAt: Date.now(),
      ...overrides,
    };
  }

  beforeEach(() => {
    rawDb = {
      getAllAsync: jest.fn().mockResolvedValue([]),
    };
    withExclusiveWriteCall = 0;

    mockUpdateWhere = jest.fn();
    mockUpdateSet = jest.fn().mockReturnValue({ where: mockUpdateWhere });

    mockDb = {
      update: jest.fn().mockReturnValue({ set: mockUpdateSet }),
    };

    (dbClient.createDrizzleDb as jest.Mock).mockReturnValue(mockDb);

    (dbClient.withExclusiveWrite as jest.Mock).mockImplementation(async (db, task) => {
      withExclusiveWriteCall += 1;

      if (withExclusiveWriteCall === 1) {
        return task(
          {
            ...mockDb,
            update: jest.fn().mockReturnValue({ set: mockUpdateSet }),
          },
          db,
        );
      }

      return task(mockDb, db);
    });

    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects when bridge config is missing or incomplete', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue(null);

    await expect(syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0])).rejects.toThrow(
      'Bridge config is missing or incomplete',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still posts to /api/sync/reconcile when the backlog is empty', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      deviceId: 'device-abc',
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'accepted', bridge_changes: [], conflicts: [] }),
    });

    const result = await syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0]);

    expect(result).toEqual({ syncedCount: 0, backlogReadCount: 0, hasMorePending: false });
    expect(rawDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('WHERE status IN (?) ORDER BY created_at ASC, id ASC LIMIT ?'),
      'pending',
      200,
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.10:8080/api/sync/reconcile',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token123' }),
      }),
    );
  });

  it('reverts processing rows to pending on network error and propagates the error', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
    });

    rawDb.getAllAsync.mockResolvedValue([buildPendingOp()]);

    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Network Error'));

    await expect(syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0])).rejects.toThrow(
      'Network Error',
    );
    expect(dbClient.withExclusiveWrite).toHaveBeenCalledTimes(2);
    expect(mockUpdateSet).toHaveBeenLastCalledWith({ status: 'pending' });
  });

  it('reverts processing rows to pending on HTTP error and propagates the error', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
    });

    rawDb.getAllAsync.mockResolvedValue([buildPendingOp()]);

    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });

    await expect(syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0])).rejects.toThrow(
      'Reconcile failed: 500',
    );
    expect(dbClient.withExclusiveWrite).toHaveBeenCalledTimes(2);
    expect(mockUpdateSet).toHaveBeenLastCalledWith({ status: 'pending' });
  });

  it('moves processing rows to dead_letter on client HTTP error and logs the rejected payload', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      deviceId: 'device-abc',
    });

    rawDb.getAllAsync.mockResolvedValue([
      buildPendingOp({ payload: JSON.stringify({ nrocapvisto: -1 }), createdAt: 1710000000000 }),
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'nrocapvisto must be >= 0' }),
    });

    await expect(syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0])).rejects.toThrow(
      'Reconcile failed: 400',
    );
    expect(dbClient.withExclusiveWrite).toHaveBeenCalledTimes(2);
    expect(mockUpdateSet).toHaveBeenLastCalledWith({ status: 'dead_letter' });
    expect(warnSpy).toHaveBeenCalledWith(
      '[syncPendingOperations] Reconcile request failed',
      expect.objectContaining({
        url: 'http://192.168.1.10:8080/api/sync/reconcile',
        status: 400,
        responseBody: JSON.stringify({ error: 'nrocapvisto must be >= 0' }),
      }),
    );

    warnSpy.mockRestore();
  });

  it('sanitizes an invalid lastChangelogId before serializing the request body', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      id: 1,
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      deviceId: 'device-abc',
      lastChangelogId: 'last_changelog_id',
    });

    rawDb.getAllAsync.mockResolvedValue([
      buildPendingOp({ createdAt: 1710000000000 }),
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'accepted', bridge_changes: [], conflicts: [] }),
    });

    await syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0]);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.10:8080/api/sync/reconcile',
      expect.objectContaining({
        body: JSON.stringify({
          device_id: 'device-abc',
          last_changelog_id: 0,
          pending_operations: [
            {
              anime_id: 'anime1',
              operation: 'update',
              payload: { nrocapvisto: 5 },
              created_at: 1710000000000,
            },
          ],
        }),
      }),
    );
  });

  it('sanitizes a corrupted timestamp cursor before serializing the request body', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      id: 1,
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      deviceId: 'device-abc',
      lastChangelogId: 1_710_000_001_000,
    });

    rawDb.getAllAsync.mockResolvedValue([
      buildPendingOp({ createdAt: 1710000000000 }),
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'accepted', bridge_changes: [], conflicts: [] }),
    });

    await syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0]);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.10:8080/api/sync/reconcile',
      expect.objectContaining({
        body: expect.stringContaining('"last_changelog_id":0'),
      }),
    );
  });

  it('marks rows as synced when applied_operations confirms them', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      deviceId: 'device-abc',
    });

    rawDb.getAllAsync.mockResolvedValue([buildPendingOp()]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'accepted',
        applied_operations: [
          {
            anime_id: 'anime1',
            operation: 'update',
            applied: true,
          },
        ],
        bridge_changes: [
          {
            record_id: 'anime1',
            change_type: 'update',
            changed_fields: ['nrocapvisto'],
            timestamp: Date.now(),
          },
        ],
        conflicts: [],
        last_changelog_id: 99,
      }),
    });

    const result = await syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0]);

    expect(result).toEqual({ syncedCount: 1, backlogReadCount: 1, hasMorePending: false });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.10:8080/api/sync/reconcile',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token123',
        },
      }),
    );
    expect(dbClient.withExclusiveWrite).toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: 'synced' });
  });

  it('advances lastChangelogId from the response cursor, not from bridge change timestamps', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      deviceId: 'device-abc',
      lastChangelogId: 5,
    });

    rawDb.getAllAsync.mockResolvedValue([buildPendingOp()]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'accepted',
        applied_operations: [
          {
            anime_id: 'anime1',
            operation: 'update',
            applied: true,
          },
        ],
        bridge_changes: [
          {
            record_id: 'anime1',
            change_type: 'update',
            changed_fields: ['nrocapvisto'],
            timestamp: 1710000001000,
          },
        ],
        conflicts: [],
        last_changelog_id: 10,
      }),
    });

    await syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0]);

    const lastChangelogIdUpdate = mockUpdateSet.mock.calls.find(
      (call) => typeof call[0] === 'object' && 'lastChangelogId' in call[0],
    );

    expect(lastChangelogIdUpdate?.[0]).toEqual({ lastChangelogId: 10 });
  });

  it('does not mark synced when applied_operations rejects the operation even if bridge_changes exist', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      deviceId: 'device-abc',
    });

    rawDb.getAllAsync.mockResolvedValue([buildPendingOp()]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'accepted',
        applied_operations: [
          {
            anime_id: 'anime1',
            operation: 'update',
            applied: false,
          },
        ],
        bridge_changes: [
          {
            record_id: 'anime1',
            change_type: 'update',
            changed_fields: ['nrocapvisto'],
            timestamp: Date.now(),
          },
        ],
        conflicts: [],
        last_changelog_id: 99,
      }),
    });

    const result = await syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0]);

    expect(result.syncedCount).toBe(0);
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: 'pending' });
  });

  it('does not mark synced when the bridge returns no application evidence', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      deviceId: 'device-abc',
    });

    rawDb.getAllAsync.mockResolvedValue([buildPendingOp()]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'accepted', bridge_changes: [], conflicts: [] }),
    });

    const result = await syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0]);

    expect(result.syncedCount).toBe(0);
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: 'pending' });
  });
});
