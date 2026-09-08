import * as clientHelpers from '../../../src/infrastructure/db/client/client.helpers';
import { createSyncDiagnosticsOutboxStore } from '../../../src/infrastructure/db/sync-diagnostics-outbox';
import { SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS } from '../../../src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox.constants';
import { createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

/** A timestamp far enough in the future that every persisted not-before gate has already opened. */
const FAR_FUTURE = 999_999_999_999;

describe('sync diagnostics outbox store', () => {
  /** Opens one real in-memory database and records how it was asked for. */
  function buildOpener() {
    const calls: unknown[] = [];
    const adapter = createTestSqliteAdapter();

    return {
      adapter,
      calls,
      open: (options?: unknown) => {
        calls.push(options);
        return adapter;
      },
    };
  }

  it('opens its OWN database file on a private connection, never the app database', () => {
    const opener = buildOpener();

    createSyncDiagnosticsOutboxStore({ openDatabase: opener.open }).enqueue({
      cycleId: 'cycle-1',
      payload: '{}',
    });

    expect(opener.calls).toHaveLength(1);
    expect(opener.calls[0]).toMatchObject({
      databaseName: 'autoreas-telemetry.db',
      useNewConnection: true,
      enableChangeListener: false,
      busyTimeoutMs: 250,
    });
  });

  it('enqueues an entry that a later readFlushCandidates call returns', () => {
    const opener = buildOpener();
    const store = createSyncDiagnosticsOutboxStore({ openDatabase: opener.open, now: () => 1_000 });

    store.enqueue({ cycleId: 'cycle-1', payload: '{"cycle_id":"cycle-1"}' });

    expect(store.readFlushCandidates(10, 1_000)).toEqual([
      { cycleId: 'cycle-1', payload: '{"cycle_id":"cycle-1"}', createdAt: 1_000 },
    ]);
  });

  it('remove deletes the row by cycle_id, so a later read no longer returns it', () => {
    const opener = buildOpener();
    const store = createSyncDiagnosticsOutboxStore({ openDatabase: opener.open, now: () => 1_000 });

    store.enqueue({ cycleId: 'cycle-1', payload: '{}' });
    store.remove('cycle-1');

    expect(store.readFlushCandidates(10, 1_000)).toEqual([]);
  });

  it('never routes its writes through the shared local-write door', () => {
    // This store exists to escape exactly that failure domain (Decision 7); a caller that
    // accidentally routed it through `withLocalWrite` would queue behind the very hang it must
    // survive.
    const spy = jest.spyOn(clientHelpers, 'withLocalWrite');
    const opener = buildOpener();
    const store = createSyncDiagnosticsOutboxStore({ openDatabase: opener.open, now: () => 1_000 });

    store.enqueue({ cycleId: 'cycle-1', payload: '{}' });
    store.remove('cycle-1');
    store.deferUntil(9_999);
    store.readFlushCandidates(10, 0);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  describe('eviction at exactly the row cap (Decision 3, guard cycle #1)', () => {
    it('evicts nothing when inserting below the cap', () => {
      const opener = buildOpener();
      const store = createSyncDiagnosticsOutboxStore({ openDatabase: opener.open });

      for (let i = 0; i < SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS - 1; i += 1) {
        store.enqueue({ cycleId: `cycle-${i}`, payload: '{}' });
      }

      expect(store.readFlushCandidates(1_000, FAR_FUTURE)).toHaveLength(
        SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS - 1,
      );
    });

    it('evicts exactly the single oldest row once the insert past the cap lands', () => {
      const opener = buildOpener();
      let clock = 0;
      const store = createSyncDiagnosticsOutboxStore({
        openDatabase: opener.open,
        now: () => (clock += 1),
      });

      for (let i = 0; i < SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS; i += 1) {
        store.enqueue({ cycleId: `cycle-${i}`, payload: '{}' });
      }
      store.enqueue({ cycleId: 'cycle-overflow', payload: '{}' });

      const candidates = store.readFlushCandidates(1_000, FAR_FUTURE);
      const cycleIds = candidates.map((candidate) => candidate.cycleId);

      expect(candidates).toHaveLength(SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS);
      expect(cycleIds).not.toContain('cycle-0');
      expect(cycleIds).toContain('cycle-overflow');
    });
  });

  describe('the not-before gate is a clock comparison (Decision 6, guard cycle #2)', () => {
    it('returns [] when the cycle starts before the persisted not-before', () => {
      const opener = buildOpener();
      const store = createSyncDiagnosticsOutboxStore({ openDatabase: opener.open, now: () => 1_000 });

      store.enqueue({ cycleId: 'cycle-1', payload: '{}' });
      store.deferUntil(5_000);

      expect(store.readFlushCandidates(10, 4_999)).toEqual([]);
    });

    it('returns the row once the cycle starts at or after the persisted not-before', () => {
      const opener = buildOpener();
      const store = createSyncDiagnosticsOutboxStore({ openDatabase: opener.open, now: () => 1_000 });

      store.enqueue({ cycleId: 'cycle-1', payload: '{}' });
      store.deferUntil(5_000);

      expect(store.readFlushCandidates(10, 5_000)).toHaveLength(1);
    });
  });

  describe('a rerun with the same cycle_id (Decision 3, guard cycle #6)', () => {
    it('leaves created_at unchanged on a repeated insert for the same cycle_id', () => {
      // Simulates `syncPendingOperations`'s rerun loop re-entering `performSyncPendingOperations`
      // with the same telemetryContext, and therefore the same cycle_id (reconcile.helpers.ts:119-126).
      const opener = buildOpener();
      let clock = 1_000;
      const store = createSyncDiagnosticsOutboxStore({ openDatabase: opener.open, now: () => clock });

      store.enqueue({ cycleId: 'cycle-1', payload: '{"attempt":"first"}' });
      clock = 9_000;
      store.enqueue({ cycleId: 'cycle-1', payload: '{"attempt":"second"}' });

      expect(store.readFlushCandidates(10, FAR_FUTURE)).toEqual([
        { cycleId: 'cycle-1', payload: '{"attempt":"first"}', createdAt: 1_000 },
      ]);
    });
  });

  it('never throws when the underlying write fails, and counts the failure', () => {
    const store = createSyncDiagnosticsOutboxStore({
      openDatabase: () => {
        throw new Error('telemetry database unavailable');
      },
    });

    expect(() => store.enqueue({ cycleId: 'cycle-1', payload: '{}' })).not.toThrow();
    expect(store.getFailedWriteCount()).toBe(1);
  });
});
