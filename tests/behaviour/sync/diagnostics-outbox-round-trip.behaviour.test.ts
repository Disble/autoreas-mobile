import type { SQLiteDatabase } from 'expo-sqlite';
import { runMigrations } from '../../../src/infrastructure/db/client';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import {
  getSyncRuntimeStatusSnapshot,
  recordSyncAttemptSucceeded,
} from '../../../src/features/sync/sync-runtime-status.helpers';
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

/**
 * How old the PARKED rows this suite plants are, in ms -- the fixture side of the age bound.
 *
 * LITERALS, never `SYNC_DIAGNOSTICS_PARKED_ROW_MAX_AGE_MS`: 8 days is beyond the declared 7-day
 * bound and 6 days is inside it, so mutating the bound fails the case that depends on the side it
 * moved -- the same reason the refusal-code tests assert the literal code instead of the constant.
 */
const STALE_AGE_MS = 8 * 24 * 60 * 60 * 1_000;

/** The same bound from the safe side: a row this young must never be retired by a clock. */
const YOUNG_AGE_MS = 6 * 24 * 60 * 60 * 1_000;

/**
 * Empties the private outbox, its not-before gate and its shed counter before each case.
 *
 * The store MEMOISES its connection for the whole file
 * (`sync-diagnostics-outbox-instance.constants.ts`), so one adapter is shared by every case here and
 * the setup must CLEAR tables rather than construct a new database: resetting `mockTelemetryAdapter`
 * would leave the store writing into this case's predecessor's file while the assertions read an
 * empty one.
 */
async function clearTelemetryOutbox(): Promise<void> {
  if (!mockTelemetryAdapter) {
    return;
  }

  await mockTelemetryAdapter.execAsync(
    'DELETE FROM sync_diagnostics_outbox; ' +
      'DELETE FROM sync_diagnostics_outbox_state; ' +
      'DELETE FROM sync_diagnostics_outbox_shed_count;',
  );
}

/**
 * Plants one stored body straight into the outbox at an explicit age, so a case can be older or
 * younger than the declared bound without owning a clock.
 */
async function plantStoredRow(cycleId: string, payload: string, ageMs: number): Promise<void> {
  await mockTelemetryAdapter!.runAsync(
    'INSERT INTO sync_diagnostics_outbox (cycle_id, payload, created_at) VALUES (?, ?, ?)',
    cycleId,
    payload,
    Date.now() - ageMs,
  );
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
    lastDiagnosticsUndeliverableCount: null,
    lastDiagnosticsUnclassifiedCount: null,
    lastDiagnosticsReapedCount: null,
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

/**
 * Opens a migrated database wired to a paired bridge, with no pending outbox operations.
 *
 * `runMigrations` runs AFTER the migration files for the same reason a device needs both: the
 * migration files are a fresh install's route, while several `sync_runtime_status` columns (and the
 * tables created imperatively) exist only as idempotent repairs on an installed device -- and this
 * suite reaches those columns through `getSyncRuntimeStatusSnapshot`.
 */
async function openPairedDatabase() {
  const adapter: SQLiteDatabase = createTestSqliteAdapter();

  await applyMigrationFiles(adapter);
  await runMigrations(adapter);
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

  beforeEach(async () => {
    fakeBridge = installFakeBridge();
    await clearTelemetryOutbox();
  });

  afterEach(() => {
    fakeBridge.restore();
  });

  it('survives a failing diagnostics POST and clears once a later cycle gets a success', async () => {
    const adapter = await openPairedDatabase();

    // Cycle 1: the envelope is captured, then the diagnostics POST fails -- the row must
    // survive. Reconcile itself still succeeds; the two are independent (Decision 5).
    //
    // `500`, deliberately NOT `503`. A header-less `503` is the bridge's own backpressure verdict
    // and now defers the next pass by its declared wait (`SYNC_DIAGNOSTICS_UNAVAILABLE_RETRY_AFTER_MS`,
    // 5s), so a cycle running immediately after would find the not-before gate closed and read no
    // candidates at all -- the rule working as intended, not a delivery failure to survive here.
    // That deferral is pinned by the focused suite (`sync-diagnostics-flush.helpers.test.ts`,
    // "defers by the bridge-declared wait on a 503 that carries no usable Retry-After"). `500`
    // declares no wait, so this test keeps proving the one property it exists for: a failing
    // diagnostics POST is survived and cleared once a later cycle gets a success.
    fakeBridge.queueResponse({ status: 500, body: {} });
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

  it('reaps a parked row older than the bound, delivers the routable row behind it, and sheds nothing', async () => {
    const adapter = await openPairedDatabase();
    // A row this build cannot name, planted eight days ago, ahead of the routable envelope this
    // same cycle captures. Before the age bound this row occupied the batch's oldest slot on EVERY
    // pass, and the cap (which sheds the newest overflow) eventually spent the whole retained window
    // on rows that could never drain.
    await plantStoredRow(
      'stale-unknown-kind',
      JSON.stringify({ kind: 'watch_session', phase: 'received' }),
      STALE_AGE_MS,
    );
    fakeBridge.queueResponse({ status: 200, body: {} });
    queueAcceptedReconcileResponse(fakeBridge);

    const result = await syncPendingOperations(adapter, 'deferred', buildTelemetryContext('cycle-1'));

    // The park was retired by the CLOCK -- its own counter, and neither a discard (the bridge
    // refused nothing: it never saw this row) nor a shed (the cap dropped nothing) -- and the
    // routable row behind it still went out, which is the liveness the bound exists for.
    expect(result.diagnosticsFlush).toEqual({
      attempted: 1,
      delivered: 1,
      discarded: 0,
      failedRemovals: 0,
      undeliverable: 0,
      unclassified: 0,
      reaped: 1,
    });

    const survivors = await mockTelemetryAdapter!.getAllAsync<StoredDiagnosticsOutboxRow>(
      'SELECT cycle_id, payload FROM sync_diagnostics_outbox',
    );
    const shed = await mockTelemetryAdapter!.getAllAsync<{ shed_rows: number }>(
      'SELECT shed_rows FROM sync_diagnostics_outbox_shed_count',
    );

    expect(survivors.map((row) => row.cycle_id)).toEqual([]);
    // No row until the first shed, so an empty read IS the cap having dropped nothing.
    expect(shed).toEqual([]);

    // And the counter is PERSISTED, through the write the foreground cycle already performs: the
    // reap is readable where the destruction counters are, and `discarded` stays a measured zero.
    await recordSyncAttemptSucceeded(adapter, 'background_task', Date.now(), 0, null, result.diagnosticsFlush);
    const status = await getSyncRuntimeStatusSnapshot(adapter);

    expect(status.lastDiagnosticsReapedCount).toBe(1);
    expect(status.lastDiagnosticsDiscardedCount).toBe(0);
    expect(status.lastDiagnosticsUnclassifiedCount).toBe(0);
  });

  it('keeps `reaped` distinct from `discarded` in ONE mixed batch -- two different verdicts, two counters', async () => {
    const adapter = await openPairedDatabase();
    // Four candidate shapes in one pass, oldest first:
    // - a stale row this build does not name (PARKED, then retired by the clock);
    // - a stale ROUTABLE row the bridge permanently rejects with a declared code (DISCARDED -- and
    //   proof that a verdict, not the clock, removes a row the bridge answered about);
    // - this cycle's own fresh envelope, which the bridge accepts (DELIVERED).
    await plantStoredRow(
      'stale-unknown-kind',
      JSON.stringify({ kind: 'watch_session', phase: 'received' }),
      STALE_AGE_MS,
    );
    await plantStoredRow(
      'stale-refused',
      JSON.stringify({ cycle_id: 'stale-refused' }),
      STALE_AGE_MS,
    );
    fakeBridge.queueResponse({ status: 400, body: { code: 'field_rejected' } });
    fakeBridge.queueResponse({ status: 200, body: {} });
    queueAcceptedReconcileResponse(fakeBridge);

    const result = await syncPendingOperations(adapter, 'deferred', buildTelemetryContext('cycle-4'));

    // `reaped` moved because a CLOCK expired on a row nothing had judged; `discarded` moved because
    // the BRIDGE condemned bytes it was asked about. Folding either into the other would make a
    // non-zero `discarded` unable to say which of the two happened -- and neither is a `shed`, which
    // is the cap dropping the newest overflow and which this pass did not cause.
    expect(result.diagnosticsFlush).toEqual({
      attempted: 2,
      delivered: 1,
      discarded: 1,
      failedRemovals: 0,
      undeliverable: 0,
      unclassified: 0,
      reaped: 1,
    });

    const survivors = await mockTelemetryAdapter!.getAllAsync<StoredDiagnosticsOutboxRow>(
      'SELECT cycle_id, payload FROM sync_diagnostics_outbox',
    );
    const shed = await mockTelemetryAdapter!.getAllAsync<{ shed_rows: number }>(
      'SELECT shed_rows FROM sync_diagnostics_outbox_shed_count',
    );

    expect(survivors.map((row) => row.cycle_id)).toEqual([]);
    expect(shed).toEqual([]);
  });

  it('never reaps a row a bridge verdict decided: a stale routable row is DELIVERED, not retired', async () => {
    const adapter = await openPairedDatabase();
    // Eight days old and perfectly deliverable: the bound lands on how long we WAIT, never on the
    // bytes, so a row a later bridge finally accepts must be counted as the delivery it is.
    await plantStoredRow('stale-routable', JSON.stringify({ cycle_id: 'stale-routable' }), STALE_AGE_MS);
    // Two diagnostics POSTs (the planted row and this cycle's own envelope) then the reconcile.
    fakeBridge.queueResponse({ status: 200, body: {} });
    fakeBridge.queueResponse({ status: 200, body: {} });
    queueAcceptedReconcileResponse(fakeBridge);

    const result = await syncPendingOperations(adapter, 'deferred', buildTelemetryContext('cycle-2'));

    expect(result.diagnosticsFlush).toEqual({
      attempted: 2,
      delivered: 2,
      discarded: 0,
      failedRemovals: 0,
      undeliverable: 0,
      unclassified: 0,
      reaped: 0,
    });
  });

  it('leaves a parked row YOUNGER than the bound untouched, and still delivers what is behind it', async () => {
    const adapter = await openPairedDatabase();
    await plantStoredRow(
      'young-unknown-kind',
      JSON.stringify({ kind: 'watch_session', phase: 'received' }),
      YOUNG_AGE_MS,
    );
    fakeBridge.queueResponse({ status: 200, body: {} });
    queueAcceptedReconcileResponse(fakeBridge);

    const result = await syncPendingOperations(adapter, 'deferred', buildTelemetryContext('cycle-3'));

    // Still parked: counted as `unclassified`, never as `reaped`, and the row is still queued for
    // the pass that eventually follows a bridge that serves its kind.
    expect(result.diagnosticsFlush).toEqual({
      attempted: 1,
      delivered: 1,
      discarded: 0,
      failedRemovals: 0,
      undeliverable: 0,
      unclassified: 1,
      reaped: 0,
    });

    const survivors = await mockTelemetryAdapter!.getAllAsync<StoredDiagnosticsOutboxRow>(
      'SELECT cycle_id, payload FROM sync_diagnostics_outbox',
    );

    expect(survivors.map((row) => row.cycle_id)).toEqual(['young-unknown-kind']);
  });
});
