import { bridgeClient } from '../../../src/infrastructure/api';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import * as dbClient from '../../../src/infrastructure/db/client';

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
  openDatabaseSync: jest.fn(),
}));

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: {
    reconcile: jest.fn(),
  },
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  createDrizzleDb: jest.fn(),
  getBridgeConfigSnapshot: jest.fn(),
  withExclusiveWrite: jest.fn(),
  withDeferredWrite: jest.fn(),
}));

jest.mock('../../../src/features/sync/merge', () => ({
  applyRemoteChanges: jest.fn().mockResolvedValue({ applied: 0, dropped: 0, deferred: 0 }),
  loadGuardMap: jest.fn().mockResolvedValue(new Map()),
  loadPendingOutboxRecordIds: jest.fn().mockResolvedValue(new Set()),
}));

jest.mock('../../../src/features/sync/pending-remote-changes.helpers', () => ({
  stagePendingRemoteChanges: jest.fn().mockResolvedValue(undefined),
}));

const RECONCILE_URL = 'http://192.168.1.10:8080/api/sync/reconcile';

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

  const reconcileMock = bridgeClient.reconcile as jest.Mock;

  function reconcileResult(overrides: Record<string, unknown> = {}) {
    return {
      ok: true,
      status: 202,
      data: { status: 'accepted', bridge_changes: [], conflicts: [] },
      rawBody: '{}',
      url: RECONCILE_URL,
      ...overrides,
    };
  }

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

    // The reconcile apply block now runs on the shared reactive connection (deferred write)
    // so local useLiveQuery consumers refresh immediately after pulling bridge changes.
    (dbClient.withDeferredWrite as jest.Mock).mockImplementation(async (db, task) =>
      task(mockDb, db),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects when bridge config is missing or incomplete', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue(null);

    await expect(syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0])).rejects.toThrow(
      'Bridge config is missing or incomplete',
    );
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('still posts to /api/sync/reconcile when the backlog is empty', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      deviceId: 'device-abc',
    });

    reconcileMock.mockResolvedValue(reconcileResult());

    const result = await syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0]);

    expect(result).toEqual({ syncedCount: 0, backlogReadCount: 0, hasMorePending: false });
    // Backlog includes 'processing' so ops orphaned by a crashed/killed cycle are recovered
    // (re-sent + confirmed), instead of perpetually blocking their anime via defer_outbox.
    expect(rawDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('WHERE status IN (?, ?) ORDER BY created_at ASC, id ASC LIMIT ?'),
      'pending',
      'processing',
      200,
    );
    expect(reconcileMock).toHaveBeenCalledWith(
      { ip: '192.168.1.10', port: 8080, token: 'token123' },
      expect.objectContaining({
        device_id: 'device-abc',
        last_changelog_id: 0,
        pending_operations: [],
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

    reconcileMock.mockRejectedValueOnce(new TypeError('Network Error'));

    await expect(syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0])).rejects.toThrow(
      'Network Error',
    );
    expect(dbClient.withExclusiveWrite).toHaveBeenCalledTimes(2);
    expect(mockUpdateSet).toHaveBeenLastCalledWith({ status: 'pending' });
  });

  it('reverts processing rows to pending on server HTTP error and propagates the error', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
    });

    rawDb.getAllAsync.mockResolvedValue([buildPendingOp()]);

    reconcileMock.mockResolvedValue(
      reconcileResult({ ok: false, status: 500, data: null, rawBody: null }),
    );

    await expect(syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0])).rejects.toThrow(
      'Reconcile failed: 500',
    );
    expect(dbClient.withExclusiveWrite).toHaveBeenCalledTimes(2);
    expect(mockUpdateSet).toHaveBeenLastCalledWith({ status: 'pending' });
  });

  it('moves processing rows to dead_letter on client HTTP error and logs the rejected payload', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const responseBody = JSON.stringify({ error: 'nrocapvisto must be >= 0' });

    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      deviceId: 'device-abc',
    });

    rawDb.getAllAsync.mockResolvedValue([
      buildPendingOp({ payload: JSON.stringify({ nrocapvisto: -1 }), createdAt: 1710000000000 }),
    ]);

    reconcileMock.mockResolvedValue(
      reconcileResult({ ok: false, status: 400, data: { error: 'nrocapvisto must be >= 0' }, rawBody: responseBody }),
    );

    await expect(syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0])).rejects.toThrow(
      'Reconcile failed: 400',
    );
    expect(dbClient.withExclusiveWrite).toHaveBeenCalledTimes(2);
    expect(mockUpdateSet).toHaveBeenLastCalledWith({ status: 'dead_letter' });
    expect(warnSpy).toHaveBeenCalledWith(
      '[syncPendingOperations] Reconcile request failed',
      expect.objectContaining({
        url: RECONCILE_URL,
        status: 400,
        responseBody,
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

    reconcileMock.mockResolvedValue(reconcileResult());

    await syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0]);

    expect(reconcileMock).toHaveBeenCalledWith(
      { ip: '192.168.1.10', port: 8080, token: 'token123' },
      {
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
      },
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

    reconcileMock.mockResolvedValue(reconcileResult());

    await syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0]);

    expect(reconcileMock).toHaveBeenCalledWith(
      { ip: '192.168.1.10', port: 8080, token: 'token123' },
      expect.objectContaining({ last_changelog_id: 0 }),
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

    reconcileMock.mockResolvedValue(
      reconcileResult({
        data: {
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
        },
      }),
    );

    const result = await syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0]);

    expect(result).toEqual({ syncedCount: 1, backlogReadCount: 1, hasMorePending: false });
    expect(reconcileMock).toHaveBeenCalledWith(
      { ip: '192.168.1.10', port: 8080, token: 'token123' },
      expect.objectContaining({ device_id: 'device-abc' }),
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

    reconcileMock.mockResolvedValue(
      reconcileResult({
        data: {
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
        },
      }),
    );

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

    reconcileMock.mockResolvedValue(
      reconcileResult({
        data: {
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
        },
      }),
    );

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

    reconcileMock.mockResolvedValue(reconcileResult());

    const result = await syncPendingOperations(rawDb as unknown as Parameters<typeof syncPendingOperations>[0]);

    expect(result.syncedCount).toBe(0);
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: 'pending' });
  });
});
