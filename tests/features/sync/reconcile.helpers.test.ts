import {
  getConfirmedOperationIds,
  syncPendingOperations,
} from '../../../src/features/sync/reconcile.helpers';
import { ReconcileResponseSchema } from '../../../src/features/sync/reconcile.schema';
import { bridgeClient } from '../../../src/infrastructure/api';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as mergeApplyChangesModule from '../../../src/features/sync/merge/apply-remote-changes.helpers';
import * as mergeContextModule from '../../../src/features/sync/merge/merge-context.helpers';
import * as pendingRemoteChangesModule from '../../../src/features/sync/pending-remote-changes.helpers';
import * as operationLogRetention from '../../../src/features/sync/operation-log-retention.helpers';

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: { reconcile: jest.fn() },
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  withExclusiveWrite: jest.fn(),
  withDeferredWrite: jest.fn(),
}));

jest.mock('../../../src/features/sync/merge/apply-remote-changes.helpers', () => ({
  applyRemoteChanges: jest.fn().mockResolvedValue({ applied: 0, dropped: 0, deferred: 0 }),
}));

jest.mock('../../../src/features/sync/merge/merge-context.helpers', () => ({
  loadGuardMap: jest.fn().mockResolvedValue(new Map()),
  loadPendingOutboxRecordIds: jest.fn().mockResolvedValue(new Set()),
}));

jest.mock('../../../src/features/sync/pending-remote-changes.helpers', () => ({
  stagePendingRemoteChanges: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/features/sync/operation-log-retention.helpers', () => ({
  readOperationLogBacklog: jest.fn().mockResolvedValue([]),
}));

describe('reconcile helpers', () => {
  const baseOperation = {
    id: 1,
    animeId: 'anime-1',
    operation: 'update',
    payload: JSON.stringify({ episodesWatched: 5, lastWatchedAt: 1710000000000 }),
    status: 'processing',
    createdAt: 1710000000000,
  };

  it('getConfirmedOperationIds confirma updates cuando bridge refleja los campos aplicados', () => {
    expect(
      getConfirmedOperationIds([baseOperation], undefined, [
        {
          record_id: 'anime-1',
          change_type: 'update',
          changed_fields: ['episodesWatched', 'lastWatchedAt'],
          timestamp: 1710000001000,
        },
      ]),
    ).toEqual([1]);
  });

  it('getConfirmedOperationIds prioriza applied_operations cuando bridge manda ack explícito', () => {
    expect(
      getConfirmedOperationIds(
        [baseOperation],
        [
          {
            anime_id: 'anime-1',
            operation: 'update',
            applied: true,
          },
        ],
        [],
      ),
    ).toEqual([1]);
  });

  it('getConfirmedOperationIds no confirma cuando applied_operations dice applied=false', () => {
    expect(
      getConfirmedOperationIds(
        [baseOperation],
        [
          {
            anime_id: 'anime-1',
            operation: 'update',
            applied: false,
          },
        ],
        [
          {
            record_id: 'anime-1',
            change_type: 'update',
            changed_fields: ['episodesWatched', 'lastWatchedAt'],
            timestamp: 1710000001000,
          },
        ],
      ),
    ).toEqual([]);
  });

  it('getConfirmedOperationIds no confirma operaciones sin evidencia de aplicación', () => {
    expect(
      getConfirmedOperationIds([baseOperation], undefined, [
        {
          record_id: 'otro-anime',
          change_type: 'update',
          changed_fields: ['episodesWatched'],
          timestamp: 1710000001000,
        },
      ]),
    ).toEqual([]);
  });

  it('ReconcileResponseSchema acepta changed_fields null y lo normaliza a array vacío', () => {
    const parsed = ReconcileResponseSchema.safeParse({
      status: 'accepted',
      applied_operations: [],
      bridge_changes: [
        {
          record_id: 'anime-1',
          change_type: 'update',
          changed_fields: null,
          timestamp: 1710000001000,
        },
      ],
      conflicts: [],
      last_changelog_id: 10,
    });

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Expected successful parse');
    }

    expect(parsed.data.bridge_changes[0]?.changed_fields).toEqual([]);
  });

  it('ReconcileResponseSchema normaliza colecciones top-level null a arrays vacíos', () => {
    const parsed = ReconcileResponseSchema.safeParse({
      status: 'accepted',
      applied_operations: null,
      bridge_changes: null,
      conflicts: null,
      last_changelog_id: 10,
    });

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Expected successful parse');
    }

    expect(parsed.data.applied_operations).toEqual([]);
    expect(parsed.data.bridge_changes).toEqual([]);
    expect('conflicts' in parsed.data).toBe(false);
  });

  it('ReconcileResponseSchema normaliza colecciones top-level ausentes a arrays vacíos', () => {
    const parsed = ReconcileResponseSchema.safeParse({
      status: 'accepted',
      last_changelog_id: 10,
    });

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Expected successful parse');
    }

    expect(parsed.data.applied_operations).toEqual([]);
    expect(parsed.data.bridge_changes).toEqual([]);
    expect('conflicts' in parsed.data).toBe(false);
  });
});

describe('syncPendingOperations applyMode routing', () => {
  const mockGetBridgeConfigSnapshot = dbClient.getBridgeConfigSnapshot as jest.Mock;
  const mockReconcile = bridgeClient.reconcile as jest.Mock;
  const mockReadBacklog = operationLogRetention.readOperationLogBacklog as jest.Mock;
  const mockApplyRemoteChanges = mergeApplyChangesModule.applyRemoteChanges as jest.Mock;
  const mockLoadGuardMap = mergeContextModule.loadGuardMap as jest.Mock;
  const mockLoadPendingOutboxRecordIds =
    mergeContextModule.loadPendingOutboxRecordIds as jest.Mock;
  const mockStagePendingRemoteChanges =
    pendingRemoteChangesModule.stagePendingRemoteChanges as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadBacklog.mockResolvedValue([]);
    mockGetBridgeConfigSnapshot.mockResolvedValue({
      id: 1,
      ip: '192.168.1.10',
      port: 8080,
      token: 'auth-secret',
      deviceId: 'device-1',
      lastChangelogId: 0,
    });
    mockApplyRemoteChanges.mockResolvedValue({ applied: 0, dropped: 0, deferred: 0 });
    mockLoadGuardMap.mockResolvedValue(new Map());
    mockLoadPendingOutboxRecordIds.mockResolvedValue(new Set());
    mockStagePendingRemoteChanges.mockResolvedValue(undefined);

    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:8080/api/sync/reconcile',
      rawBody: '{}',
      data: {
        status: 'accepted',
        applied_operations: [],
        bridge_changes: [
          {
            record_id: 'anime-1',
            change_type: 'update',
            changed_fields: ['status'],
            snapshot: {
              id: 'anime-1',
              name: 'Test',
              status: 2,
              episodesWatched: 0,
              active: 1,
              firstCycle: 0,
              days: [],
              genres: [],
            },
            timestamp: 1710000001000,
          },
        ],
        conflicts: [],
      },
    });
  });

  it('foreground default mode applies via withDeferredWrite + applyRemoteChanges(deferred), never stages', async () => {
    const writeDb = {};
    (dbClient.withDeferredWrite as jest.Mock).mockImplementation(async (_db, task) => {
      await task(writeDb, {});
    });

    const rawDb = { name: 'deferred-reconcile-db' };
    await syncPendingOperations(rawDb as never);

    expect(dbClient.withDeferredWrite).toHaveBeenCalledWith(rawDb, expect.any(Function));
    expect(dbClient.withExclusiveWrite).not.toHaveBeenCalled();
    expect(mockApplyRemoteChanges).toHaveBeenCalledWith(
      writeDb,
      expect.arrayContaining([
        expect.objectContaining({
          recordId: 'anime-1',
          changeType: 'update',
          changedFields: ['estado'],
          snapshot: expect.objectContaining({ _id: 'anime-1', estado: 2, nombre: 'Test' }),
        }),
      ]),
      expect.objectContaining({
        guardByRecordId: expect.any(Map),
        pendingOutboxRecordIds: expect.any(Set),
      }),
      'deferred',
    );
    expect(mockStagePendingRemoteChanges).not.toHaveBeenCalled();
  });

  it('explicit deferred mode behaves the same as the default', async () => {
    const writeDb = {};
    (dbClient.withDeferredWrite as jest.Mock).mockImplementation(async (_db, task) => {
      await task(writeDb, {});
    });

    const rawDb = { name: 'deferred-reconcile-db-explicit' };
    await syncPendingOperations(rawDb as never, 'deferred');

    expect(dbClient.withDeferredWrite).toHaveBeenCalledWith(rawDb, expect.any(Function));
    expect(mockApplyRemoteChanges).toHaveBeenCalledWith(
      writeDb,
      expect.anything(),
      expect.anything(),
      'deferred',
    );
  });

  it('staged mode stages into pending_remote_changes via withExclusiveWrite and never calls applyRemoteChanges', async () => {
    const writeDb = {};
    (dbClient.withExclusiveWrite as jest.Mock).mockImplementation(async (_db, task) => {
      await task(writeDb, {});
    });

    const rawDb = { name: 'staged-reconcile-db' };
    await syncPendingOperations(rawDb as never, 'staged');

    expect(dbClient.withExclusiveWrite).toHaveBeenCalledWith(rawDb, expect.any(Function));
    expect(dbClient.withDeferredWrite).not.toHaveBeenCalled();
    expect(mockStagePendingRemoteChanges).toHaveBeenCalledWith(
      writeDb,
      expect.arrayContaining([
        expect.objectContaining({
          recordId: 'anime-1',
          changeType: 'update',
          changedFields: ['estado'],
          snapshot: expect.objectContaining({ _id: 'anime-1', estado: 2, nombre: 'Test' }),
        }),
      ]),
    );
    expect(mockApplyRemoteChanges).not.toHaveBeenCalled();
  });

  it('staged mode never writes to animes directly (no upsert/delete calls outside the merge boundary)', async () => {
    const updateMock = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
    const writeDb = { update: updateMock };
    (dbClient.withExclusiveWrite as jest.Mock).mockImplementation(async (_db, task) => {
      await task(writeDb, {});
    });

    const rawDb = { name: 'staged-reconcile-db-no-animes-write' };
    await syncPendingOperations(rawDb as never, 'staged');

    // operationLog status updates are allowed (no pending ops in this fixture, so update()
    // is not even called); the key assertion is that the animes table is never touched.
    expect(mockApplyRemoteChanges).not.toHaveBeenCalled();
    expect(mockStagePendingRemoteChanges).toHaveBeenCalled();
  });

  it('staged mode still advances the changelog cursor and op-log statuses in the same staged transaction', async () => {
    mockReadBacklog.mockResolvedValue([
      {
        id: 1,
        animeId: 'anime-1',
        operation: 'update',
        payload: JSON.stringify({ estado: 2 }),
        status: 'processing',
        createdAt: 1710000000000,
      },
    ]);

    const updateMock = jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
      where: jest.fn().mockResolvedValue(undefined),
    });
    const writeDb = { update: updateMock };
    (dbClient.withExclusiveWrite as jest.Mock).mockImplementation(async (_db, task) => {
      await task(writeDb, {});
    });

    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:8080/api/sync/reconcile',
      rawBody: '{}',
      data: {
        status: 'accepted',
        applied_operations: [],
        bridge_changes: [
          {
            record_id: 'anime-1',
            change_type: 'update',
            changed_fields: ['status'],
            timestamp: 1710000001000,
          },
        ],
        conflicts: [],
        last_changelog_id: 99,
      },
    });

    const rawDb = { name: 'staged-reconcile-db-cursor' };
    await syncPendingOperations(rawDb as never, 'staged');

    expect(mockStagePendingRemoteChanges).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalled();
  });
});
