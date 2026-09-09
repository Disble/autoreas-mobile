import type { SQLiteDatabase } from 'expo-sqlite';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import type { ReconcileTelemetryContext } from '../../../src/features/sync/reconcile.types';
import type { SyncRuntimeStatusSnapshot } from '../../../src/features/sync/sync-runtime-status.types';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

/**
 * The diagnostics outbox lives on its OWN private SQLite connection
 * (`sync-diagnostics-outbox-instance.constants.ts`, opened via `openTelemetryDatabaseSync`),
 * separate from the main app database. Held here so the test can inspect the outbox table
 * directly instead of reaching into the production singleton.
 */
let mockTelemetryAdapter: SQLiteDatabase | null = null;

// The ONLY production modules mocked in this suite, and only to hand drizzle a node:sqlite
// handle instead of expo-sqlite -- everything else (the write door, the reconcile logic, the
// diagnostics capture/flush algorithm, the schema, the wire mapping, the bridgeClient singleton)
// runs for real, exactly like `outbox-round-trip.behaviour.test.ts`.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => {
    if (!mockTelemetryAdapter) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- same hoisting constraint as above.
      mockTelemetryAdapter = require('../../support/sqlite-adapter.helpers').createTestSqliteAdapter();
    }

    return mockTelemetryAdapter;
  },
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** One `sync_diagnostics_outbox` row, read back directly from the private telemetry connection. */
interface StoredDiagnosticsOutboxRow {
  cycle_id: string;
  payload: string;
}

/** Builds a neutral runtime snapshot so the test only states the fields it actually exercises. */
function buildSnapshot(): SyncRuntimeStatusSnapshot {
  return {
    registrationStatus: 'registered',
    executionMode: 'best_effort_background_task',
    isForegroundServiceRunning: false,
    canShowPersistentNotification: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureMessage: null,
    lastTriggerSource: null,
    lastSyncedCount: 0,
    isCycleActive: false,
    lastBacklogReadCount: 0,
    lastPrunedOperationsCount: 0,
    isBackgroundTaskRegistered: false,
    lastCycleId: null,
    lastCycleStage: null,
    lastErrorName: null,
    lastNativeErrcodeByte: null,
    lastErrorStage: null,
    consecutiveUnclosedCycles: 0,
    lastCycleStageAt: null,
    lastFailedCheckpointCount: 0,
    lastDiagnosticsDiscardedCount: null,
    lastDiagnosticsFailedRemovalCount: null,
    lastOutboxFailedWriteCount: null,
    lastDeadLetterCount: null,
    lastConflictExhaustedCount: null,
    lastStuckProcessingCount: null,
    lastOldestPendingAgeMs: null,
    lastPendingRowCount: null,
  };
}

/** Builds one cycle's telemetry context, varying only the cycle id between calls. */
function buildTelemetryContext(cycleId: string): ReconcileTelemetryContext {
  return {
    cycleId,
    triggerSource: 'background_task',
    appState: 'background',
    snapshot: buildSnapshot(),
    recentEvents: [],
  };
}

/** Opens a migrated database wired to a paired bridge, with no pending outbox operations. */
async function openPairedDatabase() {
  const adapter: SQLiteDatabase = createTestSqliteAdapter();

  await applyMigrationFiles(adapter);
  await adapter.runAsync(
    'INSERT INTO bridge_config (id, ip, port, token, device_id, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)',
    '192.168.0.10',
    8080,
    'token-1',
    'device-1',
    0,
  );

  return adapter;
}

/** Queues a trivial accepted reconcile response -- no pending operations to confirm. */
function queueAcceptedReconcileResponse(fakeBridge: FakeBridge) {
  fakeBridge.queueResponse({
    status: 202,
    body: { status: 'accepted', applied_operations: [], bridge_changes: [], last_changelog_id: 0 },
  });
}

describe('diagnostics outbox round trip against a real database and a faked wire', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    mockTelemetryAdapter = null;
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
  });

  it('survives a failing diagnostics POST and clears once a later cycle gets a success', async () => {
    const adapter = await openPairedDatabase();

    // Cycle 1: the envelope is captured, then the diagnostics POST fails -- the row must
    // survive. Reconcile itself still succeeds; the two are independent (Decision 5).
    fakeBridge.queueResponse({ status: 503, body: {} });
    queueAcceptedReconcileResponse(fakeBridge);

    await syncPendingOperations(adapter, 'deferred', buildTelemetryContext('cycle-1'));

    expect(mockTelemetryAdapter).not.toBeNull();
    const afterCycleOne = await mockTelemetryAdapter!.getAllAsync<StoredDiagnosticsOutboxRow>(
      'SELECT cycle_id, payload FROM sync_diagnostics_outbox',
    );

    expect(afterCycleOne).toHaveLength(1);
    expect(afterCycleOne[0].cycle_id).toBe('cycle-1');
    expect(JSON.parse(afterCycleOne[0].payload)).toMatchObject({ cycle_id: 'cycle-1' });

    // Cycle 2: a fresh envelope is captured (cycle-2), and THIS cycle's diagnostics POSTs all
    // succeed -- both the row surviving from cycle 1 and the new one must clear.
    fakeBridge.queueResponse({ status: 200, body: {} });
    fakeBridge.queueResponse({ status: 200, body: {} });
    queueAcceptedReconcileResponse(fakeBridge);

    await syncPendingOperations(adapter, 'deferred', buildTelemetryContext('cycle-2'));

    const afterCycleTwo = await mockTelemetryAdapter!.getAllAsync<StoredDiagnosticsOutboxRow>(
      'SELECT cycle_id, payload FROM sync_diagnostics_outbox',
    );

    expect(afterCycleTwo).toHaveLength(0);

    // The diagnostics POSTs and the reconcile POST are independent requests on the wire.
    const urls = fakeBridge.requests.map((request) => request.url);
    const diagnosticsRequestCount = urls.filter((url) => url.includes('/api/sync/diagnostics')).length;
    const reconcileRequestCount = urls.filter((url) => url.includes('/api/sync/reconcile')).length;

    expect(diagnosticsRequestCount).toBe(3);
    expect(reconcileRequestCount).toBe(2);
  });
});
