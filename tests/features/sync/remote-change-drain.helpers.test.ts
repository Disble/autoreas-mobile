import { drainPendingRemoteChanges } from '../../../src/features/sync/remote-change-drain.helpers';
import * as dbClient from '../../../src/infrastructure/db/client';
import * as mergeModule from '../../../src/features/sync/merge';
import * as pendingRemoteChangesModule from '../../../src/features/sync/pending-remote-changes.helpers';

jest.mock('../../../src/infrastructure/db/client', () => ({
  createDrizzleDb: jest.fn(),
  withDeferredWrite: jest.fn(),
}));

jest.mock('../../../src/features/sync/merge', () => ({
  applyRemoteChanges: jest.fn(),
  loadGuardMap: jest.fn(),
  loadPendingOutboxRecordIds: jest.fn(),
}));

jest.mock('../../../src/features/sync/pending-remote-changes.helpers', () => ({
  loadPendingRemoteChanges: jest.fn(),
  deletePendingRemoteChanges: jest.fn(),
}));

describe('drainPendingRemoteChanges', () => {
  const mockCreateDrizzleDb = dbClient.createDrizzleDb as jest.Mock;
  const mockWithDeferredWrite = dbClient.withDeferredWrite as jest.Mock;
  const mockApplyRemoteChanges = mergeModule.applyRemoteChanges as jest.Mock;
  const mockLoadGuardMap = mergeModule.loadGuardMap as jest.Mock;
  const mockLoadPendingOutboxRecordIds =
    mergeModule.loadPendingOutboxRecordIds as jest.Mock;
  const mockLoadPendingRemoteChanges =
    pendingRemoteChangesModule.loadPendingRemoteChanges as jest.Mock;
  const mockDeletePendingRemoteChanges =
    pendingRemoteChangesModule.deletePendingRemoteChanges as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateDrizzleDb.mockReturnValue({ kind: 'drizzle-db' });
    mockLoadGuardMap.mockResolvedValue(new Map());
    mockLoadPendingOutboxRecordIds.mockResolvedValue(new Set());
    mockApplyRemoteChanges.mockResolvedValue({ applied: 0, dropped: 0, deferred: 0 });
    mockDeletePendingRemoteChanges.mockResolvedValue(undefined);
  });

  it('loads staged rows through a drizzle database instead of the raw SQLite connection', async () => {
    mockLoadPendingRemoteChanges.mockResolvedValue([]);

    const rawDb = { name: 'drain-db' };

    await drainPendingRemoteChanges(rawDb as never);

    expect(mockCreateDrizzleDb).toHaveBeenCalledWith(rawDb);
    expect(mockLoadPendingRemoteChanges).toHaveBeenCalledWith({ kind: 'drizzle-db' });
  });

  it('no-ops without opening a write transaction when there are no staged rows', async () => {
    mockLoadPendingRemoteChanges.mockResolvedValue([]);

    const rawDb = { name: 'drain-db' };
    const result = await drainPendingRemoteChanges(rawDb as never);

    expect(result).toEqual({ applied: 0, dropped: 0, deferred: 0, drainedCount: 0 });
    expect(mockWithDeferredWrite).not.toHaveBeenCalled();
    expect(mockApplyRemoteChanges).not.toHaveBeenCalled();
  });

  it('applies staged rows via withDeferredWrite + applyRemoteChanges(deferred), then deletes drained rows in the same transaction', async () => {
    const stagedEntries = [
      {
        stagingId: 1,
        change: {
          recordId: 'anime-1',
          changeType: 'update' as const,
          changedFields: ['estado'],
          snapshot: { _id: 'anime-1', nombre: 'Naruto', estado: 2, nrocapvisto: 0, activo: 1, primeravez: 0 } as never,
          timestamp: 1710000001000,
        },
      },
      {
        stagingId: 2,
        change: {
          recordId: 'anime-2',
          changeType: 'delete' as const,
          changedFields: [],
          timestamp: 1710000002000,
        },
      },
    ];
    mockLoadPendingRemoteChanges.mockResolvedValue(stagedEntries);
    mockApplyRemoteChanges.mockResolvedValue({ applied: 2, dropped: 0, deferred: 0 });

    const writeDb = {};
    mockWithDeferredWrite.mockImplementation(async (_db, task) => task(writeDb, {}));

    const rawDb = { name: 'drain-db' };
    const result = await drainPendingRemoteChanges(rawDb as never);

    expect(mockWithDeferredWrite).toHaveBeenCalledWith(rawDb, expect.any(Function));
    expect(mockApplyRemoteChanges).toHaveBeenCalledWith(
      writeDb,
      [stagedEntries[0].change, stagedEntries[1].change],
      expect.objectContaining({
        guardByRecordId: expect.any(Map),
        pendingOutboxRecordIds: expect.any(Set),
      }),
      'deferred',
    );
    expect(mockDeletePendingRemoteChanges).toHaveBeenCalledWith(writeDb, [1, 2]);
    expect(result).toEqual({ applied: 2, dropped: 0, deferred: 0, drainedCount: 2 });
  });

  it('deletes drained staging rows even when applyRemoteChanges drops/defers them (cleanup is unconditional once handled)', async () => {
    const stagedEntries = [
      {
        stagingId: 5,
        change: {
          recordId: 'anime-5',
          changeType: 'update' as const,
          changedFields: ['estado'],
          snapshot: { _id: 'anime-5' } as never,
          timestamp: 1,
        },
      },
    ];
    mockLoadPendingRemoteChanges.mockResolvedValue(stagedEntries);
    mockApplyRemoteChanges.mockResolvedValue({ applied: 0, dropped: 1, deferred: 0 });

    const writeDb = {};
    mockWithDeferredWrite.mockImplementation(async (_db, task) => task(writeDb, {}));

    const rawDb = { name: 'drain-db' };
    const result = await drainPendingRemoteChanges(rawDb as never);

    expect(mockDeletePendingRemoteChanges).toHaveBeenCalledWith(writeDb, [5]);
    expect(result).toEqual({ applied: 0, dropped: 1, deferred: 0, drainedCount: 1 });
  });
});
