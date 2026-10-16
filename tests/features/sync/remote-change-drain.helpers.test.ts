import {
  applyStagedAndIncomingRemoteChanges,
  drainPendingRemoteChanges,
} from '../../../src/features/sync/remote-change-drain.helpers';
import type { RemoteAnimeChange } from '../../../src/features/sync/merge/merge.types';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as mergeApplyChangesModule from '../../../src/features/sync/merge/apply-remote-changes.helpers';
import * as mergeContextModule from '../../../src/features/sync/merge/merge-context.helpers';
import * as pendingRemoteChangesModule from '../../../src/features/sync/pending-remote-changes.helpers';

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  createDrizzleDb: jest.fn(),
  withLocalWrite: jest.fn(),
}));

jest.mock('../../../src/features/sync/merge/apply-remote-changes.helpers', () => ({
  applyRemoteChanges: jest.fn(),
}));

jest.mock('../../../src/features/sync/merge/merge-context.helpers', () => ({
  loadGuardMap: jest.fn(),
  loadPendingOutboxRecordIds: jest.fn(),
}));

jest.mock('../../../src/features/sync/pending-remote-changes.helpers', () => ({
  loadPendingRemoteChanges: jest.fn(),
  deletePendingRemoteChanges: jest.fn(),
  stagePendingRemoteChanges: jest.fn(),
}));

/** Builds one update of `recordId` at `timestamp`. */
function updateOf(recordId: string, timestamp: number): RemoteAnimeChange {
  return { recordId, changeType: 'update', changedFields: ['estado'], snapshot: { _id: recordId } as never, timestamp };
}

/** Builds one delete of `recordId` at `timestamp`. */
function deleteOf(recordId: string, timestamp: number): RemoteAnimeChange {
  return { recordId, changeType: 'delete', changedFields: [], timestamp };
}

describe('drainPendingRemoteChanges', () => {
  const mockCreateDrizzleDb = dbClient.createDrizzleDb as jest.Mock;
  const mockWithDeferredWrite = dbClient.withLocalWrite as jest.Mock;
  const mockApplyRemoteChanges = mergeApplyChangesModule.applyRemoteChanges as jest.Mock;
  const mockLoadGuardMap = mergeContextModule.loadGuardMap as jest.Mock;
  const mockLoadPendingOutboxRecordIds =
    mergeContextModule.loadPendingOutboxRecordIds as jest.Mock;
  const mockLoadPendingRemoteChanges =
    pendingRemoteChangesModule.loadPendingRemoteChanges as jest.Mock;
  const mockDeletePendingRemoteChanges =
    pendingRemoteChangesModule.deletePendingRemoteChanges as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateDrizzleDb.mockReturnValue({ kind: 'drizzle-db' });
    mockLoadGuardMap.mockResolvedValue(new Map());
    mockLoadPendingOutboxRecordIds.mockResolvedValue(new Set());
    mockApplyRemoteChanges.mockResolvedValue({ applied: 0, dropped: 0, deferred: 0, rejected: 0 });
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

    expect(result).toEqual({ applied: 0, dropped: 0, deferred: 0, rejected: 0, drainedCount: 0 });
    expect(mockWithDeferredWrite).not.toHaveBeenCalled();
    expect(mockApplyRemoteChanges).not.toHaveBeenCalled();
  });

  it('applies staged rows via withLocalWrite + applyRemoteChanges(deferred), then deletes drained rows in the same transaction', async () => {
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

  it('deletes drained staging rows even when applyRemoteChanges drops them', async () => {
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

describe('applyStagedAndIncomingRemoteChanges', () => {
  const mockApplyRemoteChanges = mergeApplyChangesModule.applyRemoteChanges as jest.Mock;
  const mockLoadPendingOutboxRecordIds =
    mergeContextModule.loadPendingOutboxRecordIds as jest.Mock;
  const mockLoadPendingRemoteChanges =
    pendingRemoteChangesModule.loadPendingRemoteChanges as jest.Mock;
  const mockDeletePendingRemoteChanges =
    pendingRemoteChangesModule.deletePendingRemoteChanges as jest.Mock;
  const mockStagePendingRemoteChanges =
    pendingRemoteChangesModule.stagePendingRemoteChanges as jest.Mock;
  const writeDb = { kind: 'write-db' };

  beforeEach(() => {
    jest.clearAllMocks();
    (mergeContextModule.loadGuardMap as jest.Mock).mockResolvedValue(new Map());
    mockLoadPendingOutboxRecordIds.mockResolvedValue(new Set(['anime-1']));
    mockApplyRemoteChanges.mockResolvedValue({ applied: 0, dropped: 0, deferred: 0, rejected: 0 });
  });

  it('merges staged and incoming changes in timestamp order, staged first on a tie', async () => {
    const staged = updateOf('anime-2', 20);
    const incomingTie = updateOf('anime-2', 20);
    const incomingEarlier = updateOf('anime-3', 10);
    mockLoadPendingRemoteChanges.mockResolvedValue([{ stagingId: 1, change: staged }]);

    await applyStagedAndIncomingRemoteChanges(writeDb as never, [incomingTie, incomingEarlier]);

    const applied = mockApplyRemoteChanges.mock.calls[0][1] as RemoteAnimeChange[];
    expect(applied).toHaveLength(3);
    expect(applied[0]).toBe(incomingEarlier);
    expect(applied[1]).toBe(staged);
    expect(applied[2]).toBe(incomingTie);
  });

  it('keeps a deferred staged row and stages a deferred incoming change, and touches nothing else', async () => {
    const deferredStaged = updateOf('anime-1', 1);
    const deferredIncoming = updateOf('anime-1', 2);
    mockLoadPendingRemoteChanges.mockResolvedValue([{ stagingId: 7, change: deferredStaged }]);

    await applyStagedAndIncomingRemoteChanges(writeDb as never, [deferredIncoming]);

    expect(mockDeletePendingRemoteChanges).not.toHaveBeenCalled();
    expect(mockStagePendingRemoteChanges).toHaveBeenCalledWith(writeDb, [deferredIncoming]);
  });

  it('keeps a deferred change when the only delete in the pass is of another anime or earlier', async () => {
    const deferredIncoming = updateOf('anime-1', 5);
    mockLoadPendingRemoteChanges.mockResolvedValue([]);

    await applyStagedAndIncomingRemoteChanges(writeDb as never, [
      deleteOf('anime-1', 4),
      deferredIncoming,
      deleteOf('anime-2', 6),
    ]);

    expect(mockStagePendingRemoteChanges).toHaveBeenCalledWith(writeDb, [deferredIncoming]);
  });

  it('keeps no deferred change that a later delete of the same anime supersedes', async () => {
    mockLoadPendingRemoteChanges.mockResolvedValue([{ stagingId: 3, change: updateOf('anime-1', 5) }]);

    await applyStagedAndIncomingRemoteChanges(writeDb as never, [deleteOf('anime-1', 5)]);

    expect(mockDeletePendingRemoteChanges).toHaveBeenCalledWith(writeDb, [3]);
    expect(mockStagePendingRemoteChanges).not.toHaveBeenCalled();
  });
});
