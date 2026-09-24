import {
  captureSyncDiagnosticsEnvelope,
  flushSyncDiagnosticsOutbox,
  isSyncDiagnosticsPayloadAccepted,
} from '../../../../src/features/sync/sync-diagnostics-flush.helpers';
import { SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS } from '../../../../src/features/sync/sync-diagnostics-flush.constants';
import type { WireSyncCycleTelemetry } from '../../../../src/features/sync/sync-telemetry.types';
import type {
  SyncDiagnosticsOutboxRecord,
  SyncDiagnosticsOutboxStore,
} from '../../../../src/infrastructure/db/sync-diagnostics-outbox';
import type { BridgeHttpResult } from '../../../../src/infrastructure/api/bridge-client/bridge-client.types';

/** Bridge coordinates shared by every test in this suite. */
const CONNECTION = { ip: '192.168.0.10', port: 8080, token: 'token-1' };

/** One fully-formed wire telemetry envelope, reused as the base fixture for every test. */
const WIRE: WireSyncCycleTelemetry = {
  cycle_id: 'cycle-1',
  degraded: null,
  trigger_source: 'background_task',
  app_state: 'background',
  previous_cycle: null,
  counters: { consecutive_unclosed_cycles: 0, pending_ops_count: 0, cursor: 0 },
  recent_events: [],
};

/** Builds a fake store double whose methods are individually assertable jest mocks. */
function buildFakeStore(
  overrides: Partial<Record<keyof SyncDiagnosticsOutboxStore, jest.Mock>> = {},
): SyncDiagnosticsOutboxStore {
  return {
    enqueue: jest.fn(),
    readFlushCandidates: jest.fn().mockReturnValue([]),
    remove: jest.fn().mockReturnValue('removed'),
    deferUntil: jest.fn(),
    getFailedWriteCount: jest.fn().mockReturnValue(0),
    ...overrides,
  } as unknown as SyncDiagnosticsOutboxStore;
}

/** Builds one flush candidate record, defaulting to a serialized copy of WIRE. */
function buildRecord(
  overrides: Partial<SyncDiagnosticsOutboxRecord> = {},
): SyncDiagnosticsOutboxRecord {
  return {
    cycleId: WIRE.cycle_id,
    payload: JSON.stringify(WIRE),
    createdAt: 1_000,
    ...overrides,
  };
}

/**
 * One stored chapter observation: a body whose `kind` the bridge does not declare, so the bridge
 * answers 400 for it -- and this flush reads 400 as "this envelope is malformed forever" and
 * deletes the row. A device that ran a build from before the recorder was gated still holds rows
 * exactly like this one, and they must never be POSTed again.
 */
const UNROUTABLE_CHAPTER_PAYLOAD = JSON.stringify({
  kind: 'chapter_action',
  action: 'cap_plus',
  phase: 'received',
  at: 1_000,
  correlation_id: 'corr-1',
});

/** Builds a bridge HTTP result double for one disposition. */
function buildResult(overrides: Partial<BridgeHttpResult> = {}): BridgeHttpResult {
  return {
    ok: true,
    status: 200,
    data: null,
    rawBody: null,
    url: 'http://192.168.0.10:8080/api/sync/diagnostics',
    retryAfterMs: null,
    ...overrides,
  };
}

describe('captureSyncDiagnosticsEnvelope', () => {
  it('enqueues the envelope keyed by its own cycle_id when telemetry is present', () => {
    const store = buildFakeStore();

    captureSyncDiagnosticsEnvelope(WIRE, { store });

    expect(store.enqueue).toHaveBeenCalledWith({
      cycleId: 'cycle-1',
      payload: JSON.stringify(WIRE),
    });
  });

  it('captures nothing when the telemetry preference is disabled -- resolveClientTelemetry already returned null', () => {
    const store = buildFakeStore();

    captureSyncDiagnosticsEnvelope(null, { store });

    expect(store.enqueue).not.toHaveBeenCalled();
  });

  it('captures nothing when the cycle supplied no telemetry context -- resolveClientTelemetry already returned null', () => {
    const store = buildFakeStore();

    captureSyncDiagnosticsEnvelope(null, { store });

    expect(store.enqueue).not.toHaveBeenCalled();
  });
});

describe('isSyncDiagnosticsPayloadAccepted', () => {
  it('accepts the kindless legacy cycle envelope, the one kind the registry still carries', () => {
    expect(isSyncDiagnosticsPayloadAccepted(WIRE)).toBe(true);
  });

  it('refuses a body that declares a kind the bridge does not accept', () => {
    expect(isSyncDiagnosticsPayloadAccepted(JSON.parse(UNROUTABLE_CHAPTER_PAYLOAD))).toBe(false);
  });

  it('refuses a body that is not an object at all, instead of guessing a kind for it', () => {
    expect(isSyncDiagnosticsPayloadAccepted(null)).toBe(false);
    expect(isSyncDiagnosticsPayloadAccepted([])).toBe(false);
    expect(isSyncDiagnosticsPayloadAccepted('chapter_action')).toBe(false);
  });
});

describe('flushSyncDiagnosticsOutbox', () => {
  it('issues zero POSTs when the gate is shut (readFlushCandidates returns [])', async () => {
    const store = buildFakeStore({ readFlushCandidates: jest.fn().mockReturnValue([]) });
    const client = { postSyncDiagnostics: jest.fn() };

    const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION, store, client });

    expect(client.postSyncDiagnostics).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 0, delivered: 0, discarded: 0, failedRemovals: 0 });
  });

  it('removes the row and continues to the next candidate on a 2xx', async () => {
    const first = buildRecord({ cycleId: 'cycle-1' });
    const second = buildRecord({ cycleId: 'cycle-2' });
    const store = buildFakeStore({
      readFlushCandidates: jest.fn().mockReturnValue([first, second]),
    });
    const postSyncDiagnostics = jest
      .fn()
      .mockResolvedValueOnce(buildResult({ ok: true, status: 200 }))
      .mockResolvedValueOnce(buildResult({ ok: true, status: 200 }));
    const client = { postSyncDiagnostics };

    const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION, store, client });

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(2);
    expect(store.remove).toHaveBeenCalledWith('cycle-1');
    expect(store.remove).toHaveBeenCalledWith('cycle-2');
    expect(result).toEqual({ attempted: 2, delivered: 2, discarded: 0, failedRemovals: 0 });
    // Timeout is passed through as the diagnostics-specific budget, never the reconcile one.
    expect(postSyncDiagnostics).toHaveBeenCalledWith(
      CONNECTION,
      expect.anything(),
      expect.objectContaining({ timeoutMs: SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS }),
    );
  });

  it('does not count delivered when the 2xx removal is not confirmed -- counts failedRemovals instead', async () => {
    // The 600,055 ms replay this change exists to close: a confirmed 2xx whose DELETE throws
    // must not be counted as delivered, since the row is still there for the next cycle to re-send.
    const first = buildRecord({ cycleId: 'cycle-1' });
    const store = buildFakeStore({
      readFlushCandidates: jest.fn().mockReturnValue([first]),
      remove: jest.fn().mockReturnValue('failed'),
    });
    const postSyncDiagnostics = jest
      .fn()
      .mockResolvedValueOnce(buildResult({ ok: true, status: 200 }));
    const client = { postSyncDiagnostics };

    const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION, store, client });

    expect(store.remove).toHaveBeenCalledWith('cycle-1');
    expect(result).toEqual({ attempted: 1, delivered: 0, discarded: 0, failedRemovals: 1 });
  });

  it('leaves the row queued and stops the batch when the request throws', async () => {
    const first = buildRecord({ cycleId: 'cycle-1' });
    const second = buildRecord({ cycleId: 'cycle-2' });
    const store = buildFakeStore({
      readFlushCandidates: jest.fn().mockReturnValue([first, second]),
    });
    const postSyncDiagnostics = jest.fn().mockRejectedValueOnce(new Error('unreachable'));
    const client = { postSyncDiagnostics };

    const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION, store, client });

    // Only the first row is even attempted -- the next row would fail identically.
    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 1, delivered: 0, discarded: 0, failedRemovals: 0 });
  });

  it('leaves the row queued AND stops the batch on a 404 -- the endpoint is not built yet', async () => {
    // BINDING per the orchestrator's amendment to Decision 4. The bridge endpoint does not
    // exist yet, so every POST returns 404 today; a blanket 4xx-deletes rule would silently
    // drain the whole queue during the dual-write window, reproducing the exact invisible-loss
    // failure this change exists to close. This case is a REGRESSION GUARD, not a maybe.
    const first = buildRecord({ cycleId: 'cycle-1' });
    const second = buildRecord({ cycleId: 'cycle-2' });
    const store = buildFakeStore({
      readFlushCandidates: jest.fn().mockReturnValue([first, second]),
    });
    const postSyncDiagnostics = jest
      .fn()
      .mockResolvedValueOnce(buildResult({ ok: false, status: 404, retryAfterMs: null }));
    const client = { postSyncDiagnostics };

    const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION, store, client });

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 1, delivered: 0, discarded: 0, failedRemovals: 0 });
  });

  it('removes the row and continues on a 400 -- the bridge names the offending field, it will reject the same bytes forever', async () => {
    const first = buildRecord({ cycleId: 'cycle-1' });
    const second = buildRecord({ cycleId: 'cycle-2' });
    const store = buildFakeStore({
      readFlushCandidates: jest.fn().mockReturnValue([first, second]),
    });
    const postSyncDiagnostics = jest
      .fn()
      .mockResolvedValueOnce(buildResult({ ok: false, status: 400, retryAfterMs: null }))
      .mockResolvedValueOnce(buildResult({ ok: true, status: 200 }));
    const client = { postSyncDiagnostics };

    const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION, store, client });

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(2);
    expect(store.remove).toHaveBeenCalledWith('cycle-1');
    expect(store.remove).toHaveBeenCalledWith('cycle-2');
    expect(result).toEqual({ attempted: 2, delivered: 1, discarded: 1, failedRemovals: 0 });
  });

  it.each([413, 422])(
    'removes the row and continues on a %d -- same envelope-malformed family as 400',
    async (status) => {
      const first = buildRecord({ cycleId: 'cycle-1' });
      const second = buildRecord({ cycleId: 'cycle-2' });
      const store = buildFakeStore({
        readFlushCandidates: jest.fn().mockReturnValue([first, second]),
      });
      const postSyncDiagnostics = jest
        .fn()
        .mockResolvedValueOnce(buildResult({ ok: false, status, retryAfterMs: null }))
        .mockResolvedValueOnce(buildResult({ ok: true, status: 200 }));
      const client = { postSyncDiagnostics };

      const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION, store, client });

      expect(postSyncDiagnostics).toHaveBeenCalledTimes(2);
      expect(store.remove).toHaveBeenCalledWith('cycle-1');
      expect(result.delivered).toBe(1);
      expect(result.discarded).toBe(1);
    },
  );

  it('leaves an unroutable body in place and still delivers the routable envelope behind it', async () => {
    // The row a pre-fix build queued, which the bridge answers 400 for: POSTing it buys the same
    // rejection and the row is deleted. So it is SKIPPED -- not removed, not discarded -- and the
    // batch keeps going, because stopping here would starve the deliverable cycle envelope queued
    // behind it. The price is the batch slot: `readFlushCandidates` handed back two candidates
    // and only one POST was issued, which is why the RECORDER gate, not this one, is the primary
    // fix -- a skipped row stays at the head of the queue and is re-read by every later pass.
    const unroutable = buildRecord({ cycleId: 'chapter-1', payload: UNROUTABLE_CHAPTER_PAYLOAD });
    const routable = buildRecord({ cycleId: 'cycle-2' });
    const store = buildFakeStore({
      readFlushCandidates: jest.fn().mockReturnValue([unroutable, routable]),
    });
    const postSyncDiagnostics = jest
      .fn()
      .mockResolvedValueOnce(buildResult({ ok: true, status: 200 }));
    const client = { postSyncDiagnostics };

    const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION, store, client });

    // The chapter body is never asked about, never deleted, and never deferred.
    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(postSyncDiagnostics).toHaveBeenCalledWith(
      CONNECTION,
      WIRE,
      expect.objectContaining({ timeoutMs: SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS }),
    );
    expect(store.remove).toHaveBeenCalledWith('cycle-2');
    expect(store.remove).not.toHaveBeenCalledWith('chapter-1');
    expect(store.deferUntil).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 1, delivered: 1, discarded: 0, failedRemovals: 0 });
  });

  it('skips every unroutable body ahead of a routable one instead of stopping at the first', async () => {
    const firstUnroutable = buildRecord({
      cycleId: 'chapter-1',
      payload: UNROUTABLE_CHAPTER_PAYLOAD,
    });
    const secondUnroutable = buildRecord({
      cycleId: 'chapter-2',
      payload: JSON.stringify({ kind: 'chapter_action', phase: 'sync', outcome: 'ok' }),
    });
    const routable = buildRecord({ cycleId: 'cycle-3' });
    const store = buildFakeStore({
      readFlushCandidates: jest.fn().mockReturnValue([firstUnroutable, secondUnroutable, routable]),
    });
    const postSyncDiagnostics = jest
      .fn()
      .mockResolvedValueOnce(buildResult({ ok: true, status: 200 }));
    const client = { postSyncDiagnostics };

    const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION, store, client });

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).toHaveBeenCalledTimes(1);
    expect(store.remove).toHaveBeenCalledWith('cycle-3');
    expect(result).toEqual({ attempted: 1, delivered: 1, discarded: 0, failedRemovals: 0 });
  });

  it.each([408, 429, 500, 503])(
    'leaves the row queued and stops the batch on a %d',
    async (status) => {
      const first = buildRecord({ cycleId: 'cycle-1' });
      const second = buildRecord({ cycleId: 'cycle-2' });
      const store = buildFakeStore({
        readFlushCandidates: jest.fn().mockReturnValue([first, second]),
      });
      const postSyncDiagnostics = jest
        .fn()
        .mockResolvedValueOnce(buildResult({ ok: false, status, retryAfterMs: null }));
      const client = { postSyncDiagnostics };

      const result = await flushSyncDiagnosticsOutbox({ connection: CONNECTION, store, client });

      expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
      expect(store.remove).not.toHaveBeenCalled();
      expect(result).toEqual({ attempted: 1, delivered: 0, discarded: 0, failedRemovals: 0 });
    },
  );

  it('persists deferUntil(now + retryAfterMs) on a transient failure that carries a Retry-After', async () => {
    const first = buildRecord({ cycleId: 'cycle-1' });
    const store = buildFakeStore({
      readFlushCandidates: jest.fn().mockReturnValue([first]),
    });
    const postSyncDiagnostics = jest
      .fn()
      .mockResolvedValueOnce(buildResult({ ok: false, status: 429, retryAfterMs: 30_000 }));
    const client = { postSyncDiagnostics };
    const now = jest.fn().mockReturnValue(1_000_000);

    await flushSyncDiagnosticsOutbox({ connection: CONNECTION, store, client, now });

    expect(store.deferUntil).toHaveBeenCalledWith(1_030_000);
  });

  it('never calls deferUntil when the transient failure carries no Retry-After', async () => {
    const first = buildRecord({ cycleId: 'cycle-1' });
    const store = buildFakeStore({
      readFlushCandidates: jest.fn().mockReturnValue([first]),
    });
    const postSyncDiagnostics = jest
      .fn()
      .mockResolvedValueOnce(buildResult({ ok: false, status: 503, retryAfterMs: null }));
    const client = { postSyncDiagnostics };

    await flushSyncDiagnosticsOutbox({ connection: CONNECTION, store, client });

    expect(store.deferUntil).not.toHaveBeenCalled();
  });

  it('performs no POST, no candidate read, no remove and no deferUntil while the switch is off', async () => {
    // The declared contract of the switch (database.schema.ts:113-115) is that turning it off
    // stops the payload being built or sent AT ALL. Gating only capture would leave every row
    // queued before the switch was flipped draining to the bridge afterwards.
    const store = buildFakeStore({
      readFlushCandidates: jest.fn().mockReturnValue([buildRecord({ cycleId: 'cycle-1' })]),
    });
    const client = { postSyncDiagnostics: jest.fn().mockResolvedValue(buildResult()) };

    const result = await flushSyncDiagnosticsOutbox({
      connection: CONNECTION,
      store,
      client,
      config: { isSyncTelemetryEnabled: false },
    });

    expect(client.postSyncDiagnostics).not.toHaveBeenCalled();
    // Not merely "no eligible candidate": the pass must not even look at the outbox.
    expect(store.readFlushCandidates).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.deferUntil).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 0, delivered: 0, discarded: 0, failedRemovals: 0 });
  });

  it('leaves the queued rows untouched while off, and delivers them once the switch is back on', async () => {
    const pending = [buildRecord({ cycleId: 'cycle-1' })];
    const store = buildFakeStore({
      readFlushCandidates: jest.fn().mockReturnValue(pending),
    });
    const postSyncDiagnostics = jest
      .fn()
      .mockResolvedValue(buildResult({ ok: true, status: 200 }));
    const client = { postSyncDiagnostics };

    await flushSyncDiagnosticsOutbox({
      connection: CONNECTION,
      store,
      client,
      config: { isSyncTelemetryEnabled: false },
    });

    // The switch is per-pass: no row is deleted or deferred because it is off, so the SAME
    // candidates are eligible again under the pre-existing rules the moment it comes back on.
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.deferUntil).not.toHaveBeenCalled();

    const result = await flushSyncDiagnosticsOutbox({
      connection: CONNECTION,
      store,
      client,
      config: { isSyncTelemetryEnabled: true },
    });

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).toHaveBeenCalledWith('cycle-1');
    expect(result).toEqual({ attempted: 1, delivered: 1, discarded: 0, failedRemovals: 0 });
  });

  it('behaves exactly as today when the switch is on', async () => {
    const store = buildFakeStore({
      readFlushCandidates: jest.fn().mockReturnValue([buildRecord({ cycleId: 'cycle-1' })]),
    });
    const postSyncDiagnostics = jest
      .fn()
      .mockResolvedValue(buildResult({ ok: true, status: 200 }));
    const client = { postSyncDiagnostics };

    const result = await flushSyncDiagnosticsOutbox({
      connection: CONNECTION,
      store,
      client,
      config: { isSyncTelemetryEnabled: true },
    });

    expect(store.readFlushCandidates).toHaveBeenCalledTimes(1);
    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).toHaveBeenCalledWith('cycle-1');
    expect(result).toEqual({ attempted: 1, delivered: 1, discarded: 0, failedRemovals: 0 });
  });
});
