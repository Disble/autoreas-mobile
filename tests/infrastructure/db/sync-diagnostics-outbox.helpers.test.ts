import * as clientHelpers from '../../../src/infrastructure/db/client/client.helpers';
import { createSyncDiagnosticsOutboxStore } from '../../../src/infrastructure/db/sync-diagnostics-outbox';
import { SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS } from '../../../src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox.constants';
import { createTestSqliteAdapter, getNativeHandle } from '../../support/sqlite-adapter.helpers';

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

  it('remove deletes the row by cycle_id, so a later read no longer returns it, and returns "removed"', () => {
    const opener = buildOpener();
    const store = createSyncDiagnosticsOutboxStore({ openDatabase: opener.open, now: () => 1_000 });

    store.enqueue({ cycleId: 'cycle-1', payload: '{}' });

    expect(store.remove('cycle-1')).toBe('removed');
    expect(store.readFlushCandidates(10, 1_000)).toEqual([]);
  });

  it('remove returns "failed" and never throws when the underlying delete throws', () => {
    const opener = buildOpener();
    const store = createSyncDiagnosticsOutboxStore({ openDatabase: opener.open, now: () => 1_000 });

    store.enqueue({ cycleId: 'cycle-1', payload: '{}' });
    getNativeHandle(opener.adapter).close();

    let outcome: string | undefined;
    expect(() => {
      outcome = store.remove('cycle-1');
    }).not.toThrow();
    expect(outcome).toBe('failed');
    expect(store.getFailedWriteCount()).toBe(1);
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

    it('sheds exactly the newest row once the insert past the cap lands, never the head', () => {
      // CONTRACT CORRECTION, not a weakened assertion: this test previously asserted the
      // OPPOSITE (`cycle-0` shed, the overflow row retained), which pinned the oldest-first
      // eviction defect the decided policy replaces. Under oldest-first the cap deleted exactly
      // the rows the drainer reads first, so an insert could destroy a row another consumer had
      // already read as a candidate and a failing POST then lost it with nothing recording it.
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
      expect(cycleIds).toContain('cycle-0');
      expect(cycleIds).not.toContain('cycle-overflow');
    });

    it('retains the oldest-prefix window, so the survivors ARE what a candidate read returns', () => {
      // THE LOAD-BEARING INVARIANT of tail-shedding: the guarantee that an in-flight row is
      // unreachable by eviction holds ONLY while the candidate query's order matches the
      // retained-prefix order. Both read `created_at ASC, rowid ASC` while the trigger sheds
      // `created_at DESC, rowid DESC`; the day either read is filtered or reordered, a row
      // vanishes with nothing reporting it and this test is the only thing that would notice.
      const opener = buildOpener();
      let clock = 0;
      const store = createSyncDiagnosticsOutboxStore({
        openDatabase: opener.open,
        now: () => (clock += 1),
      });

      for (let i = 0; i < SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS; i += 1) {
        store.enqueue({ cycleId: `cycle-${i}`, payload: '{}' });
      }
      store.enqueue({ cycleId: 'cycle-overflow-1', payload: '{}' });
      store.enqueue({ cycleId: 'cycle-overflow-2', payload: '{}' });

      const readOrder = store
        .readFlushCandidates(1_000, FAR_FUTURE)
        .map((candidate) => candidate.cycleId);
      const retainedPrefix = Array.from(
        { length: SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS },
        (_unused, index) => `cycle-${index}`,
      );

      // The candidate read returns the retained prefix, IN ORDER: the two sets are the same
      // window and neither is filtered or reversed relative to the other.
      expect(readOrder).toEqual(retainedPrefix);
      expect(readOrder).not.toContain('cycle-overflow-1');
      expect(readOrder).not.toContain('cycle-overflow-2');
    });

    it('never sheds a row a drainer has already read as a candidate', () => {
      // The in-flight guarantee in the bridge's own terms: "a delivery failure never silently
      // loses it". A drainer reads the head and POSTs it; the insert that lands while that POST
      // is on the wire must shed the TAIL, so the row being delivered is still there to re-send
      // when the POST fails -- and it can only be removed by the drainer that owns it.
      const opener = buildOpener();
      let clock = 0;
      const store = createSyncDiagnosticsOutboxStore({
        openDatabase: opener.open,
        now: () => (clock += 1),
      });

      for (let i = 0; i < SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS; i += 1) {
        store.enqueue({ cycleId: `cycle-${i}`, payload: '{}' });
      }

      const [inFlight] = store.readFlushCandidates(1, FAR_FUTURE);
      store.enqueue({ cycleId: 'cycle-overflow', payload: '{}' });

      const survivors = store
        .readFlushCandidates(1_000, FAR_FUTURE)
        .map((candidate) => candidate.cycleId);

      expect(survivors).toContain(inFlight.cycleId);
      expect(survivors).not.toContain('cycle-overflow');
    });
  });

  describe('the shed count (the bounded loss, counted distinctly)', () => {
    it('reports 0 while the cap has shed nothing', () => {
      const opener = buildOpener();
      const store = createSyncDiagnosticsOutboxStore({
        openDatabase: opener.open,
        now: () => 1_000,
      });

      store.enqueue({ cycleId: 'cycle-1', payload: '{}' });

      expect(store.getShedCount()).toBe(0);
    });

    it('counts every row the cap sheds, cumulatively and across store instances', () => {
      // A bounded loss that nothing counts was the objection that drove the policy: a row dropped
      // at the door must be visible as a number, not silently absent. The count is the store's own
      // fact and lives in the database it describes -- reopened on the same file it reports the
      // same total, which a JS variable could not do after a restart.
      const opener = buildOpener();
      let clock = 0;
      const store = createSyncDiagnosticsOutboxStore({
        openDatabase: opener.open,
        now: () => (clock += 1),
      });

      for (let i = 0; i < SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS; i += 1) {
        store.enqueue({ cycleId: `cycle-${i}`, payload: '{}' });
      }

      expect(store.getShedCount()).toBe(0);

      store.enqueue({ cycleId: 'cycle-overflow-1', payload: '{}' });
      store.enqueue({ cycleId: 'cycle-overflow-2', payload: '{}' });
      store.enqueue({ cycleId: 'cycle-overflow-3', payload: '{}' });

      expect(store.getShedCount()).toBe(3);

      const reopened = createSyncDiagnosticsOutboxStore({
        openDatabase: opener.open,
        now: () => clock,
      });

      expect(reopened.getShedCount()).toBe(3);
    });

    it('reports 0 instead of throwing when the counter cannot be read', () => {
      const opener = buildOpener();
      const store = createSyncDiagnosticsOutboxStore({
        openDatabase: opener.open,
        now: () => 1_000,
      });

      store.enqueue({ cycleId: 'cycle-1', payload: '{}' });
      getNativeHandle(opener.adapter).close();

      // Instrumentation must never be the reason a cycle fails: an unreadable counter reads as
      // "no evidence of a shed", never as an exception the caller has to handle.
      let shed = -1;
      expect(() => {
        shed = store.getShedCount();
      }).not.toThrow();
      expect(shed).toBe(0);
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
