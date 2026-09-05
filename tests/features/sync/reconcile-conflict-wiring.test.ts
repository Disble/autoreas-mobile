import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { bridgeClient } from '../../../src/infrastructure/api';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as animeRepository from '../../../src/infrastructure/db/anime-repository';
import * as mergeApplyChangesModule from '../../../src/features/sync/merge/apply-remote-changes.helpers';
import * as mergeContextModule from '../../../src/features/sync/merge/merge-context.helpers';
import * as operationLogRetention from '../../../src/features/sync/operation-log-retention.helpers';
import * as diagnosticStore from '../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers';
import { operationLog } from '../../../src/infrastructure/db/schema';

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: { reconcile: jest.fn() },
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  withLocalWrite: jest.fn(),
  createDrizzleDb: jest.fn().mockReturnValue({}),
}));

jest.mock('../../../src/infrastructure/db/anime-repository', () => ({
  persistConfirmedAnimeTokens: jest.fn().mockResolvedValue(undefined),
  applyAnimeBridgeToken: jest.fn().mockResolvedValue(undefined),
  readAnimeBridgeTokens: jest.fn().mockResolvedValue(new Map()),
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
  countOperationLogBacklogRows: jest.fn().mockResolvedValue(0),
}));

jest.mock('../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers', () => ({
  recordDiagnosticEvent: jest.fn(),
}));

/**
 * Builds a spy `writeDb` that records every `.update(table).set(values).where(cond)` call so
 * assertions can find the exact write that matters without over-mocking drizzle's chain shape.
 */
function buildWriteDbSpy() {
  const calls: { table: unknown; set: Record<string, unknown> }[] = [];
  const update = jest.fn((table: unknown) => ({
    set: jest.fn((setArgs: Record<string, unknown>) => ({
      where: jest.fn(() => {
        calls.push({ table, set: setArgs });
        return Promise.resolve(undefined);
      }),
    })),
  }));

  return { db: { update }, calls };
}

/**
 * Covers Phase 11's conflict-classification wiring inside `syncPendingOperations`: routing each
 * classifier outcome to its `operation_log`/`animes` write, and leaving the generic unconfirmed
 * bulk reset untouched by ids this wiring already handled explicitly. Split out of
 * `reconcile.helpers.test.ts` (already near the 500-line ceiling) and
 * `reconcile-confirmed-token-writeback.test.ts` (a different Part) for the same reason.
 */
describe('syncPendingOperations conflict classification wiring', () => {
  const mockGetBridgeConfigSnapshot = dbClient.getBridgeConfigSnapshot as jest.Mock;
  const mockReconcile = bridgeClient.reconcile as jest.Mock;
  const mockReadBacklog = operationLogRetention.readOperationLogBacklog as jest.Mock;
  const mockReadAnimeBridgeTokens = animeRepository.readAnimeBridgeTokens as jest.Mock;
  const mockApplyAnimeBridgeToken = animeRepository.applyAnimeBridgeToken as jest.Mock;
  const mockRecordDiagnosticEvent = diagnosticStore.recordDiagnosticEvent as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBridgeConfigSnapshot.mockResolvedValue({
      id: 1,
      ip: '192.168.1.10',
      port: 9876,
      token: 'auth-secret',
      deviceId: 'device-1',
      lastChangelogId: 0,
    });
    (mergeApplyChangesModule.applyRemoteChanges as jest.Mock).mockResolvedValue({
      applied: 0,
      dropped: 0,
      deferred: 0,
    });
    (mergeContextModule.loadGuardMap as jest.Mock).mockResolvedValue(new Map());
    (mergeContextModule.loadPendingOutboxRecordIds as jest.Mock).mockResolvedValue(new Set());
    mockReadAnimeBridgeTokens.mockResolvedValue(new Map());
  });

  it('unsupported_operation is terminal on the first response: sets operation_log to dead_letter, never pending', async () => {
    mockReadBacklog.mockResolvedValue([
      {
        id: 1,
        animeId: 'anime-1',
        operation: 'delete',
        payload: '{}',
        status: 'processing',
        createdAt: 1000,
        conflictAttemptCount: 0,
      },
    ]);
    const { db: writeDb, calls } = buildWriteDbSpy();
    (dbClient.withLocalWrite as jest.Mock).mockImplementation(async (_db, task) => task(writeDb, {}));

    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      data: {
        status: 'accepted',
        applied_operations: [
          { anime_id: 'anime-1', operation: 'delete', applied: false, reason: 'unsupported_operation' },
        ],
        bridge_changes: [],
      },
    });

    await syncPendingOperations({ name: 'unsupported-op-db' } as never);

    const operationLogCalls = calls.filter((call) => call.table === operationLog);
    expect(operationLogCalls).toContainEqual(
      expect.objectContaining({ table: operationLog, set: expect.objectContaining({ status: 'dead_letter' }) }),
    );
    expect(operationLogCalls.some((call) => call.set.status === 'pending')).toBe(false);
    expect(mockApplyAnimeBridgeToken).not.toHaveBeenCalled();
  });

  it('a progressing conflict writes the new token and re-queues for the next cycle with a reset counter', async () => {
    mockReadBacklog.mockResolvedValue([
      {
        id: 2,
        animeId: 'anime-2',
        operation: 'update',
        payload: '{}',
        status: 'processing',
        createdAt: 1000,
        conflictAttemptCount: 2,
      },
    ]);
    mockReadAnimeBridgeTokens.mockResolvedValue(new Map([['anime-2', 500]]));
    const { db: writeDb, calls } = buildWriteDbSpy();
    (dbClient.withLocalWrite as jest.Mock).mockImplementation(async (_db, task) => task(writeDb, {}));

    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      data: {
        status: 'accepted',
        applied_operations: [
          { anime_id: 'anime-2', operation: 'update', applied: false, reason: 'conflict', modified_at: 600 },
        ],
        bridge_changes: [],
      },
    });

    await syncPendingOperations({ name: 'progressing-conflict-db' } as never);

    expect(mockApplyAnimeBridgeToken).toHaveBeenCalledWith(writeDb, 'anime-2', 600);
    const operationLogCalls = calls.filter((call) => call.table === operationLog);
    expect(operationLogCalls).toContainEqual(
      expect.objectContaining({
        table: operationLog,
        set: expect.objectContaining({ status: 'pending', conflictAttemptCount: 0 }),
      }),
    );
  });

  it('a 3rd non-progressing conflict reaches conflict_exhausted, surfaced, still carrying the token', async () => {
    mockReadBacklog.mockResolvedValue([
      {
        id: 3,
        animeId: 'anime-3',
        operation: 'update',
        payload: '{}',
        status: 'processing',
        createdAt: 1000,
        conflictAttemptCount: 2,
      },
    ]);
    mockReadAnimeBridgeTokens.mockResolvedValue(new Map([['anime-3', 100]]));
    const { db: writeDb, calls } = buildWriteDbSpy();
    (dbClient.withLocalWrite as jest.Mock).mockImplementation(async (_db, task) => task(writeDb, {}));

    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      data: {
        status: 'accepted',
        applied_operations: [
          { anime_id: 'anime-3', operation: 'update', applied: false, reason: 'conflict', modified_at: 100 },
        ],
        bridge_changes: [],
      },
    });

    await syncPendingOperations({ name: 'exhausted-conflict-db' } as never);

    expect(mockApplyAnimeBridgeToken).toHaveBeenCalledWith(writeDb, 'anime-3', 100);
    const operationLogCalls = calls.filter((call) => call.table === operationLog);
    expect(operationLogCalls).toContainEqual(
      expect.objectContaining({
        table: operationLog,
        set: expect.objectContaining({ status: 'conflict_exhausted', conflictAttemptCount: 3 }),
      }),
    );
  });

  it('a conflict entry with no modified_at is surfaced as a contract violation: no token write, stays pending', async () => {
    mockReadBacklog.mockResolvedValue([
      {
        id: 4,
        animeId: 'anime-4',
        operation: 'update',
        payload: '{}',
        status: 'processing',
        createdAt: 1000,
        conflictAttemptCount: 0,
      },
    ]);
    const { db: writeDb, calls } = buildWriteDbSpy();
    (dbClient.withLocalWrite as jest.Mock).mockImplementation(async (_db, task) => task(writeDb, {}));

    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      data: {
        status: 'accepted',
        applied_operations: [
          { anime_id: 'anime-4', operation: 'update', applied: false, reason: 'conflict' },
        ],
        bridge_changes: [],
      },
    });

    await syncPendingOperations({ name: 'missing-token-conflict-db' } as never);

    expect(mockApplyAnimeBridgeToken).not.toHaveBeenCalled();
    const operationLogCalls = calls.filter((call) => call.table === operationLog);
    expect(operationLogCalls).toContainEqual(
      expect.objectContaining({ table: operationLog, set: expect.objectContaining({ status: 'pending' }) }),
    );
    expect(mockRecordDiagnosticEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'conflict_token_missing' }),
    );
  });

  it('an unrecognized reason is surfaced via a diagnostic event, neither retried as conflict nor discarded as unsupported', async () => {
    mockReadBacklog.mockResolvedValue([
      {
        id: 5,
        animeId: 'anime-5',
        operation: 'update',
        payload: '{}',
        status: 'processing',
        createdAt: 1000,
        conflictAttemptCount: 0,
      },
    ]);
    const { db: writeDb, calls } = buildWriteDbSpy();
    (dbClient.withLocalWrite as jest.Mock).mockImplementation(async (_db, task) => task(writeDb, {}));

    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      data: {
        status: 'accepted',
        applied_operations: [
          { anime_id: 'anime-5', operation: 'update', applied: false, reason: 'some_future_value' },
        ],
        bridge_changes: [],
      },
    });

    await syncPendingOperations({ name: 'unrecognized-reason-db' } as never);

    expect(mockApplyAnimeBridgeToken).not.toHaveBeenCalled();
    const operationLogCalls = calls.filter((call) => call.table === operationLog);
    expect(operationLogCalls).toContainEqual(
      expect.objectContaining({ table: operationLog, set: expect.objectContaining({ status: 'pending' }) }),
    );
    expect(mockRecordDiagnosticEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'conflict_reason_unrecognized' }),
    );
  });

  it('surfaces a stalled progressing conflict via a diagnostic event while it remains queued and keeps retrying', async () => {
    const farInThePast = 0;
    mockReadBacklog.mockResolvedValue([
      {
        id: 6,
        animeId: 'anime-6',
        operation: 'update',
        payload: '{}',
        status: 'processing',
        createdAt: farInThePast,
        conflictAttemptCount: 0,
      },
    ]);
    mockReadAnimeBridgeTokens.mockResolvedValue(new Map([['anime-6', 1]]));
    const { db: writeDb, calls } = buildWriteDbSpy();
    (dbClient.withLocalWrite as jest.Mock).mockImplementation(async (_db, task) => task(writeDb, {}));

    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      data: {
        status: 'accepted',
        applied_operations: [
          { anime_id: 'anime-6', operation: 'update', applied: false, reason: 'conflict', modified_at: 2 },
        ],
        bridge_changes: [],
      },
    });

    await syncPendingOperations({ name: 'stalled-conflict-db' } as never);

    // The operation still stays queued (status: pending), never terminalised by the stall check.
    const operationLogCalls = calls.filter((call) => call.table === operationLog);
    expect(operationLogCalls).toContainEqual(
      expect.objectContaining({ table: operationLog, set: expect.objectContaining({ status: 'pending' }) }),
    );
    expect(mockRecordDiagnosticEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'conflict_operation_stalled' }),
    );
  });
});
