import type { SQLiteDatabase } from 'expo-sqlite';
import { runMigrations } from '../../../src/infrastructure/db/client';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { flushSyncDiagnosticsOutbox } from '../../../src/features/sync/sync-diagnostics-flush.helpers';
import { syncDiagnosticsOutboxStore } from '../../../src/infrastructure/db/sync-diagnostics-outbox';
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
// diagnostics flush algorithm, the schema, the wire mapping, the bridgeClient singleton)
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
    // Dropped FIRST: a case that blocked removals at the SQLite level must never block the cleanup
    // of the case after it, which clears the very table the trigger guards.
    'DROP TRIGGER IF EXISTS sync_diagnostics_outbox_block_removal; ' +
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

/**
 * Opens a migrated database wired to a paired bridge, with no pending outbox operations.
 *
 * `runMigrations` runs AFTER the migration files for the same reason a device needs both: the
 * migration files are a fresh install's route, while the tables created imperatively exist only as
 * idempotent repairs on an installed device.
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

/** Bridge coordinates the paired database above carries, for the cases that drive the flush directly. */
const CONNECTION = { ip: '192.168.0.10', port: 8080, token: 'token-1' };

/**
 * Wakes the production outbox store: its first connect is what creates the private telemetry
 * database, its schema and the raw handle these cases plant and read through.
 */
function wakeOutbox(): SQLiteDatabase {
  syncDiagnosticsOutboxStore.getShedCount();

  return mockTelemetryAdapter!;
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
    // A row a build before convergent-sync T18 queued: nothing captures cycle envelopes any more,
    // but a device updated with rows still queued must drain them through the cycle's flush.
    wakeOutbox();
    await plantStoredRow('cycle-1', JSON.stringify({ cycle_id: 'cycle-1' }), 0);

    // Cycle 1: the diagnostics POST fails -- the row must survive. Reconcile itself still
    // succeeds; the two are independent (Decision 5).
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

    await syncPendingOperations(adapter);

    expect(mockTelemetryAdapter).not.toBeNull();
    const afterCycleOne = await mockTelemetryAdapter!.getAllAsync<StoredDiagnosticsOutboxRow>(
      'SELECT cycle_id, payload FROM sync_diagnostics_outbox',
    );

    expect(afterCycleOne).toHaveLength(1);
    expect(afterCycleOne[0].cycle_id).toBe('cycle-1');
    expect(JSON.parse(afterCycleOne[0].payload)).toMatchObject({ cycle_id: 'cycle-1' });

    // Cycle 2: THIS cycle's diagnostics POST succeeds -- the row surviving from cycle 1 clears,
    // and the cycle captures no envelope of its own.
    fakeBridge.queueResponse({ status: 200, body: {} });
    queueAcceptedReconcileResponse(fakeBridge);

    await syncPendingOperations(adapter);

    const afterCycleTwo = await mockTelemetryAdapter!.getAllAsync<StoredDiagnosticsOutboxRow>(
      'SELECT cycle_id, payload FROM sync_diagnostics_outbox',
    );

    expect(afterCycleTwo).toHaveLength(0);

    // The diagnostics POSTs and the reconcile POST are independent requests on the wire.
    const urls = fakeBridge.requests.map((request) => request.url);
    const diagnosticsRequestCount = urls.filter((url) => url.includes('/api/sync/diagnostics')).length;
    const reconcileRequestCount = urls.filter((url) => url.includes('/api/sync/reconcile')).length;

    expect(diagnosticsRequestCount).toBe(2);
    expect(reconcileRequestCount).toBe(2);
  });

  it('reaps a parked row older than the bound, delivers the routable row behind it, and sheds nothing', async () => {
    wakeOutbox();
    // A row this build cannot name, planted eight days ago, ahead of a routable envelope. Before the age bound this row occupied the batch's oldest slot on EVERY
    // pass, and the cap (which sheds the newest overflow) eventually spent the whole retained window
    // on rows that could never drain.
    await plantStoredRow(
      'stale-unknown-kind',
      JSON.stringify({ kind: 'watch_session', phase: 'received' }),
      STALE_AGE_MS,
    );
    await plantStoredRow('cycle-1', JSON.stringify({ cycle_id: 'cycle-1' }), 0);
    fakeBridge.queueResponse({ status: 200, body: {} });

    const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION });

    // The park was retired by the CLOCK -- its own counter, and neither a discard (the bridge
    // refused nothing: it never saw this row) nor a shed (the cap dropped nothing) -- and the
    // routable row behind it still went out, which is the liveness the bound exists for.
    expect(result).toEqual({
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

  });

  it('keeps `reaped` distinct from `discarded` in ONE mixed batch -- two different verdicts, two counters', async () => {
    wakeOutbox();
    // Three candidate shapes in one pass, oldest first:
    // - a stale row this build does not name (PARKED, then retired by the clock);
    // - a stale ROUTABLE row the bridge permanently rejects with a declared code (DISCARDED -- and
    //   proof that a verdict, not the clock, removes a row the bridge answered about);
    // - a fresh routable envelope, which the bridge accepts (DELIVERED).
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
    await plantStoredRow('cycle-4', JSON.stringify({ cycle_id: 'cycle-4' }), 0);
    fakeBridge.queueResponse({ status: 400, body: { code: 'field_rejected' } });
    fakeBridge.queueResponse({ status: 200, body: {} });

    const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION });

    // `reaped` moved because a CLOCK expired on a row nothing had judged; `discarded` moved because
    // the BRIDGE condemned bytes it was asked about. Folding either into the other would make a
    // non-zero `discarded` unable to say which of the two happened -- and neither is a `shed`, which
    // is the cap dropping the newest overflow and which this pass did not cause.
    expect(result).toEqual({
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

  it('never reaps a row a bridge verdict decided: a stale CHAPTER observation is DELIVERED, not retired', async () => {
    wakeOutbox();
    // The stored body is a REAL chapter observation -- the kind this build now serves -- so this is
    // the flip end to end: the real classifier routes it and the wire receives it instead of
    // parking it. Eight days old and perfectly deliverable: the bound lands on how long we WAIT,
    // never on the bytes, so a row the bridge accepts must be counted as the delivery it is.
    await plantStoredRow('stale-routable', JSON.stringify({ kind: 'episode_action' }), STALE_AGE_MS);
    await plantStoredRow('cycle-2', JSON.stringify({ cycle_id: 'cycle-2' }), 0);
    // Two diagnostics POSTs: the stale chapter observation and the fresh envelope behind it.
    fakeBridge.queueResponse({ status: 200, body: {} });
    fakeBridge.queueResponse({ status: 200, body: {} });

    const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION });

    expect(result).toEqual({
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
    wakeOutbox();
    await plantStoredRow(
      'young-unknown-kind',
      JSON.stringify({ kind: 'watch_session', phase: 'received' }),
      YOUNG_AGE_MS,
    );
    await plantStoredRow('cycle-3', JSON.stringify({ cycle_id: 'cycle-3' }), 0);
    fakeBridge.queueResponse({ status: 200, body: {} });

    const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION });

    // Still parked: counted as `unclassified`, never as `reaped`, and the row is still queued for
    // the pass that eventually follows a bridge that serves its kind.
    expect(result).toEqual({
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

  /**
   * The rest of the executor's contract, against the REAL store and a faked wire: what a pass
   * counts when a removal it was authorized to perform does NOT happen.
   *
   * Here rather than in either focused suite because BOTH of those sit at the 500-line ceiling, and
   * because an unconfirmed removal is a property of the store itself: `remove()` answers `'failed'`
   * only when the DELETE throws, which no fake store can prove.
   */
  describe('when a removal is not confirmed', () => {
    /**
     * Makes every outbox DELETE throw -- the ONLY way the real store answers `'failed'` -- so a case
     * can watch a pass whose removals did not happen. Dropped by the NEXT case's cleanup.
     */
    async function blockOutboxRemovals(): Promise<void> {
      await wakeOutbox().execAsync(
        'CREATE TRIGGER IF NOT EXISTS sync_diagnostics_outbox_block_removal ' +
          "BEFORE DELETE ON sync_diagnostics_outbox BEGIN SELECT RAISE(ABORT, 'blocked'); END",
      );
    }

    /** The outbox oldest-first, the order the candidate read itself uses. */
    async function readOutbox(): Promise<readonly string[]> {
      const rows = await wakeOutbox().getAllAsync<StoredDiagnosticsOutboxRow>(
        'SELECT cycle_id, payload FROM sync_diagnostics_outbox ORDER BY created_at ASC, rowid ASC',
      );

      return rows.map((row) => row.cycle_id);
    }

    it('counts an UNCONFIRMED removal as failedRemovals for a reap, a destruction and a delivery alike', async () => {
      // Three authorized removals, none of which happened: the stale unknown-kind park the clock
      // retires, the routable row the bridge permanently rejects, and the routable row it accepts.
      // Every row STAYS, so counting any of them as the disposition it replaced would report a
      // removal -- for the park, a destruction -- that the device never performed.
      await wakeOutbox();
      await plantStoredRow('stale-unknown-kind', JSON.stringify({ kind: 'watch_session' }), STALE_AGE_MS);
      await plantStoredRow('stale-refused', JSON.stringify({ cycle_id: 'stale-refused' }), STALE_AGE_MS - 1_000);
      await plantStoredRow('accepted', JSON.stringify({ cycle_id: 'accepted' }), STALE_AGE_MS - 2_000);
      await blockOutboxRemovals();
      fakeBridge.queueResponse({ status: 400, body: { code: 'field_rejected' } });
      fakeBridge.queueResponse({ status: 200, body: {} });

      const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION });

      expect(result).toEqual({
        attempted: 2,
        delivered: 0,
        discarded: 0,
        failedRemovals: 3,
        undeliverable: 0,
        unclassified: 0,
        reaped: 0,
      });
      expect(await readOutbox()).toEqual(['stale-unknown-kind', 'stale-refused', 'accepted']);
    });

    it('reaps a stale codeless-400 park and STILL stops the batch, so the row behind it is never POSTed', async () => {
      // A KINDLESS row is routable under the frozen legacy rule, so it IS posted -- and a bridge
      // older than the refusal vocabulary answers the generic codeless `400`, which parks it and
      // STOPS the batch. The clock then retires the parked row, and the STOP must survive that
      // retirement: it is the RETIRED disposition's own answer, never the reap's.
      await wakeOutbox();
      await plantStoredRow('stale-codeless', JSON.stringify({ cycle_id: 'stale-codeless' }), STALE_AGE_MS);
      await plantStoredRow('stale-behind', JSON.stringify({ cycle_id: 'stale-behind' }), STALE_AGE_MS - 1_000);
      fakeBridge.queueResponse({ status: 400, body: { error: 'invalid request body' } });

      const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION });

      expect(result).toEqual({
        attempted: 1,
        delivered: 0,
        discarded: 0,
        failedRemovals: 0,
        undeliverable: 0,
        unclassified: 0,
        reaped: 1,
      });
      // Exactly ONE diagnostics POST, and only the reaped row left the outbox: the row behind it is
      // still queued, because the batch stopped instead of carrying on into the same refusal.
      const diagnosticsPosts = fakeBridge.requests.filter((request) =>
        request.url.includes('/api/sync/diagnostics'),
      );

      expect(diagnosticsPosts).toHaveLength(1);
      expect(await readOutbox()).toEqual(['stale-behind']);
    });
  });
});
