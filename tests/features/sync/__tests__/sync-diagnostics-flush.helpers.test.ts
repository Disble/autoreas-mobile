import {
  captureSyncDiagnosticsEnvelope,
  flushSyncDiagnosticsOutbox,
  isSyncDiagnosticsPayloadAccepted,
} from '../../../../src/features/sync/sync-diagnostics-flush.helpers';
import {
  SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS,
  SYNC_DIAGNOSTICS_UNAVAILABLE_RETRY_AFTER_MS,
  SYNC_DIAGNOSTICS_UNDELIVERABLE_KINDS,
} from '../../../../src/features/sync/sync-diagnostics-flush.constants';
import type { SyncDiagnosticsFlushResult } from '../../../../src/features/sync/sync-diagnostics-flush.types';
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

/** The tally of a pass that did nothing, plus whichever counters the caller names as moved. */
function tally(overrides: Partial<SyncDiagnosticsFlushResult> = {}): SyncDiagnosticsFlushResult {
  return {
    attempted: 0,
    delivered: 0,
    discarded: 0,
    failedRemovals: 0,
    undeliverable: 0,
    unclassified: 0,
    ...overrides,
  };
}

/**
 * One stored observation whose `kind` this build does not declare: `watch_session` belongs to a
 * different build of ours, and only the top-level `kind` is ever read -- every other field stays
 * opaque and the body reaches the wire byte-identical. It is NOT POSTed and NOT deleted -- not
 * being in the registry is not a destruction trigger -- so it parks, keeps its batch slot, and
 * every later pass re-reads it.
 */
const UNROUTABLE_CHAPTER_PAYLOAD = JSON.stringify(
  { kind: 'watch_session', action: 'cap_plus', phase: 'received', at: 1_000, correlation_id: 'corr-1' },
);

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

/**
 * Runs one flush pass over `records`, answering each POST with the next queued verdict (an `Error`
 * verdict is a transport failure). A POST beyond the queue rejects loudly instead of resolving to
 * `undefined`, so an unexpected request fails the call-count assertions rather than passing.
 */
async function runFlush(
  records: readonly SyncDiagnosticsOutboxRecord[],
  verdicts: readonly (BridgeHttpResult | Error)[] = [],
  overrides: Partial<{
    now: () => number;
    config: { isSyncTelemetryEnabled?: unknown } | null;
    undeliverableKinds: readonly string[];
    removeResult: 'removed' | 'failed';
  }> = {},
) {
  const { removeResult = 'removed', ...flushParams } = overrides;
  const store = buildFakeStore({
    readFlushCandidates: jest.fn().mockReturnValue([...records]),
    remove: jest.fn().mockReturnValue(removeResult),
  });
  const postSyncDiagnostics = jest.fn().mockRejectedValue(new Error('unexpected POST'));
  for (const verdict of verdicts) {
    if (verdict instanceof Error) {
      postSyncDiagnostics.mockRejectedValueOnce(verdict);
    } else {
      postSyncDiagnostics.mockResolvedValueOnce(verdict);
    }
  }

  const result = await flushSyncDiagnosticsOutbox({
    connection: CONNECTION,
    store,
    client: { postSyncDiagnostics },
    ...flushParams,
  });

  return { store, postSyncDiagnostics, result };
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

  it('refuses an explicit null kind -- absence is the legacy rule, null is a declaration', () => {
    // `[undefined].includes(null)` is false: the registry reads absent keys, never null values.
    expect(isSyncDiagnosticsPayloadAccepted({ kind: null })).toBe(false);
  });
});

describe('flushSyncDiagnosticsOutbox', () => {
  it('issues zero POSTs when the gate is shut (readFlushCandidates returns [])', async () => {
    const { postSyncDiagnostics, result } = await runFlush([]);

    expect(postSyncDiagnostics).not.toHaveBeenCalled();
    expect(result).toEqual(tally());
  });

  it('removes the row and continues to the next candidate on a 2xx', async () => {
    const { store, postSyncDiagnostics, result } = await runFlush(
      [buildRecord({ cycleId: 'cycle-1' }), buildRecord({ cycleId: 'cycle-2' })],
      [buildResult({ ok: true, status: 200 }), buildResult({ ok: true, status: 200 })],
    );

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(2);
    expect(store.remove).toHaveBeenCalledWith('cycle-1');
    expect(store.remove).toHaveBeenCalledWith('cycle-2');
    expect(result).toEqual(tally({ attempted: 2, delivered: 2 }));
    // Timeout is passed through as the diagnostics-specific budget, never the reconcile one.
    expect(postSyncDiagnostics).toHaveBeenCalledWith(
      CONNECTION,
      expect.anything(),
      expect.objectContaining({ timeoutMs: SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS }),
    );
  });

  it('does not count delivered when the 2xx removal is not confirmed -- counts failedRemovals instead', async () => {
    // The 600,055 ms replay this change exists to close: a 2xx whose DELETE throws is not delivered, since the row is still there to re-send.
    const { store, result } = await runFlush(
      [buildRecord({ cycleId: 'cycle-1' })],
      [buildResult({ ok: true, status: 200 })],
      { removeResult: 'failed' },
    );

    expect(result).toEqual(tally({ attempted: 1, failedRemovals: 1 }));
    expect(store.remove).toHaveBeenCalledWith('cycle-1');
  });

  it('leaves the row queued and stops the batch when the request throws', async () => {
    const { store, postSyncDiagnostics, result } = await runFlush(
      [buildRecord({ cycleId: 'cycle-1' }), buildRecord({ cycleId: 'cycle-2' })],
      [new Error('unreachable')],
    );

    // Only the first row is even attempted -- the next row would fail identically.
    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.deferUntil).not.toHaveBeenCalled();
    expect(result).toEqual(tally({ attempted: 1 }));
  });

  it('leaves the row queued AND stops the batch on a 404 -- the endpoint is not built yet', async () => {
    // BINDING per the orchestrator's amendment to Decision 4. The endpoint does not exist yet, so
    // every POST returns 404 today; a blanket 4xx-deletes rule would silently drain the whole queue
    // during the dual-write window, reproducing the invisible-loss failure this change closes.
    const { store, postSyncDiagnostics, result } = await runFlush(
      [buildRecord({ cycleId: 'cycle-1' }), buildRecord({ cycleId: 'cycle-2' })],
      [buildResult({ ok: false, status: 404, retryAfterMs: null })],
    );

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.deferUntil).not.toHaveBeenCalled();
    expect(result).toEqual(tally({ attempted: 1 }));
  });

  it('removes the row and continues on a 400 -- the bridge names the offending field, it will reject the same bytes forever', async () => {
    const { store, postSyncDiagnostics, result } = await runFlush(
      [buildRecord({ cycleId: 'cycle-1' }), buildRecord({ cycleId: 'cycle-2' })],
      [buildResult({ ok: false, status: 400, retryAfterMs: null }), buildResult()],
    );

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(2);
    expect(store.remove).toHaveBeenCalledWith('cycle-1');
    expect(store.remove).toHaveBeenCalledWith('cycle-2');
    expect(result).toEqual(tally({ attempted: 2, delivered: 1, discarded: 1 }));
  });

  it('removes the row and continues on a 413 -- the declared permanence set is exactly 400 and 413', async () => {
    const { store, postSyncDiagnostics, result } = await runFlush(
      [buildRecord({ cycleId: 'cycle-1' }), buildRecord({ cycleId: 'cycle-2' })],
      [buildResult({ ok: false, status: 413, retryAfterMs: null }), buildResult()],
    );

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(2);
    expect(store.remove).toHaveBeenCalledWith('cycle-1');
    expect(result.delivered).toBe(1);
    expect(result.discarded).toBe(1);
  });

  it('keeps the row, defers nothing and stops the batch on a 422 -- NOT a permanence verdict here', async () => {
    // CONTRACT CORRECTION, not a weakened assertion: the old revision asserted a 422 discarded the
    // row, and that was the error. The bridge's only permanence property for this endpoint is 400
    // and 413; the inherited 422 belongs to another endpoint's handler (`season_rating_handler.go`),
    // whose answer about a grade says nothing about these bytes. Permanence is declared by the
    // contract and by nothing else, so anything undeclared is retryable -- and the row survives.
    const { store, postSyncDiagnostics, result } = await runFlush(
      [buildRecord({ cycleId: 'cycle-1' }), buildRecord({ cycleId: 'cycle-2' })],
      [buildResult({ ok: false, status: 422, retryAfterMs: null })],
    );

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.deferUntil).not.toHaveBeenCalled();
    expect(result).toEqual(tally({ attempted: 1 }));
  });

  it('destroys nothing by declaration today -- and never destroys what it merely does not know', () => {
    // Empty ON PURPOSE: destruction needs a declaration that the bridge refuses that kind forever.
    expect(SYNC_DIAGNOSTICS_UNDELIVERABLE_KINDS).toHaveLength(0);
  });

  it('deletes a DECLARED undeliverable kind without a request, counts it, and continues the batch', async () => {
    // The only destructive-by-judgement branch: this build KNOWS the bridge will never take that
    // kind, so parking could never resolve it. Injected, because the production set is empty.
    const undeliverable = buildRecord({
      cycleId: 'retired-1',
      payload: JSON.stringify({ kind: 'retired_kind' }),
    });
    const routable = buildRecord({ cycleId: 'cycle-2' });
    const { store, postSyncDiagnostics, result } = await runFlush(
      [undeliverable, routable],
      [buildResult()],
      { undeliverableKinds: ['retired_kind'] },
    );

    // Never posted, deleted on sight, and the deliverable row behind it still goes out.
    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(postSyncDiagnostics).toHaveBeenCalledWith(CONNECTION, WIRE, expect.anything());
    expect(store.remove).toHaveBeenCalledWith('retired-1');
    expect(store.remove).toHaveBeenCalledWith('cycle-2');
    expect(result).toEqual(tally({ attempted: 1, delivered: 1, undeliverable: 1 }));
  });

  it('parks an unknown kind -- never posted, never deleted, counted as unclassified, batch continues', async () => {
    // The row a pre-fix build queued, plus the row a LATER build would queue: neither is delivered
    // here and neither is destroyed, because rolling forward recovers them. Stopping would instead
    // let one unclassified row starve every deliverable envelope behind it.
    const { store, postSyncDiagnostics, result } = await runFlush(
      [
        buildRecord({ cycleId: 'chapter-1', payload: UNROUTABLE_CHAPTER_PAYLOAD }),
        buildRecord({ cycleId: 'chapter-2', payload: JSON.stringify({ kind: 'episode_action' }) }),
        buildRecord({ cycleId: 'cycle-3' }),
      ],
      [buildResult()],
    );

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(postSyncDiagnostics).toHaveBeenCalledWith(
      CONNECTION,
      WIRE,
      expect.objectContaining({ timeoutMs: SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS }),
    );
    expect(store.remove).toHaveBeenCalledTimes(1);
    expect(store.remove).toHaveBeenCalledWith('cycle-3');
    expect(store.deferUntil).not.toHaveBeenCalled();
    expect(result).toEqual(tally({ attempted: 1, delivered: 1, unclassified: 2 }));
  });

  it.each(['{ not json', '[1,2,3]', '"chapter_action"', 'null'])(
    'parks a body that is not a JSON object (%s) and keeps the batch going instead of stopping',
    async (payload) => {
      // STOP-ON-UNPARSEABLE WAS THE DEFECT. A body this build cannot read as an object is an
      // unclassified row, not a stop: stopping strands every deliverable row behind one poison row
      // on every future pass -- the starvation class this work already fixed twice. Such bytes can
      // only be authored by a build that is not this one, and the bridge owns their fate.
      const { store, postSyncDiagnostics, result } = await runFlush(
        [buildRecord({ cycleId: 'poison-1', payload }), buildRecord({ cycleId: 'cycle-2' })],
        [buildResult()],
      );

      expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
      expect(store.remove).toHaveBeenCalledTimes(1);
      expect(store.remove).toHaveBeenCalledWith('cycle-2');
      expect(result).toEqual(tally({ attempted: 1, delivered: 1, unclassified: 1 }));
    },
  );

  it('parks a present null kind as unclassified -- absence is legacy, null is a declaration', async () => {
    // `{"kind": null}` is NOT the legacy rule -- that is the ABSENCE of the key. A present null is a declaration this build cannot name: parked, never deleted, batch goes on.
    const { store, postSyncDiagnostics, result } = await runFlush(
      [
        buildRecord({ cycleId: 'null-kind-1', payload: JSON.stringify({ kind: null }) }),
        buildRecord({ cycleId: 'cycle-2' }),
      ],
      [buildResult()],
    );

    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).toHaveBeenCalledTimes(1);
    expect(store.remove).toHaveBeenCalledWith('cycle-2');
    expect(result).toEqual(tally({ attempted: 1, delivered: 1, unclassified: 1 }));
  });

  it('keeps the three destruction counters distinct in one mixed batch', async () => {
    const { result } = await runFlush(
      [
        buildRecord({ cycleId: 'retired-1', payload: JSON.stringify({ kind: 'retired_kind' }) }),
        buildRecord({ cycleId: 'chapter-1', payload: UNROUTABLE_CHAPTER_PAYLOAD }),
        buildRecord({ cycleId: 'cycle-2' }),
        buildRecord({ cycleId: 'cycle-3' }),
      ],
      [buildResult(), buildResult({ ok: false, status: 400, retryAfterMs: null })],
      { undeliverableKinds: ['retired_kind'] },
    );

    // `attempted` counts REQUESTS (2); `discarded` is the bridge's verdict destroying a body (1);
    // `undeliverable` is this build's declaration destroying one (1); `unclassified` is a parked
    // row this build does not know (1) -- none of them is a synonym for another.
    expect(result).toEqual(tally({ attempted: 2, delivered: 1, discarded: 1, undeliverable: 1, unclassified: 1 }));
  });

  it.each([401, 408, 429, 500])(
    'leaves the row queued, stops the batch and defers nothing on a %d',
    async (status) => {
      const { store, postSyncDiagnostics, result } = await runFlush(
        [buildRecord({ cycleId: 'cycle-1' }), buildRecord({ cycleId: 'cycle-2' })],
        [buildResult({ ok: false, status, retryAfterMs: null })],
      );

      expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
      expect(store.remove).not.toHaveBeenCalled();
      expect(store.deferUntil).not.toHaveBeenCalled();
      expect(result).toEqual(tally({ attempted: 1 }));
    },
  );

  it('persists deferUntil(now + retryAfterMs) on a transient failure that carries a Retry-After', async () => {
    const now = jest.fn().mockReturnValue(1_000_000);
    const { store } = await runFlush(
      [buildRecord({ cycleId: 'cycle-1' })],
      [buildResult({ ok: false, status: 429, retryAfterMs: 30_000 })],
      { now },
    );

    expect(store.deferUntil).toHaveBeenCalledWith(1_030_000);
  });

  it('defers by the bridge-declared wait on a 503 that carries no usable Retry-After', async () => {
    // REACHABLE, not defensive: the bridge has two 503 paths and only the write-budget shed sends
    // the header -- the ingestion-unavailable path sends none. Without this fallback the gate stays
    // open and the very next trigger POSTs back into a bridge already asking for room. Scoped to
    // 503 ALONE: every other retryable verdict declares no wait, so a gate there would be a backoff
    // this app made up rather than one the bridge asked for.
    const now = jest.fn().mockReturnValue(1_000_000);
    const { store, result } = await runFlush(
      [buildRecord({ cycleId: 'cycle-1' }), buildRecord({ cycleId: 'cycle-2' })],
      [buildResult({ ok: false, status: 503, retryAfterMs: null })],
      { now },
    );

    expect(store.deferUntil).toHaveBeenCalledWith(1_000_000 + SYNC_DIAGNOSTICS_UNAVAILABLE_RETRY_AFTER_MS);
    expect(store.remove).not.toHaveBeenCalled();
    expect(result).toEqual(tally({ attempted: 1 }));
  });

  it('performs no POST, no candidate read, no remove and no deferUntil while the switch is off', async () => {
    // The switch's contract (database.schema.ts:113-115) is that turning it off stops the payload being built or sent AT ALL: gating only capture would leave every row queued before the flip draining to the bridge afterwards.
    const { store, postSyncDiagnostics, result } = await runFlush(
      [buildRecord({ cycleId: 'cycle-1' })],
      [],
      { config: { isSyncTelemetryEnabled: false } },
    );

    expect(postSyncDiagnostics).not.toHaveBeenCalled();
    // Not merely "no eligible candidate": the pass must not even look at the outbox.
    expect(store.readFlushCandidates).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.deferUntil).not.toHaveBeenCalled();
    expect(result).toEqual(tally());
  });

  it('leaves the queued rows untouched while off, and delivers them once the switch is back on', async () => {
    const store = buildFakeStore({
      readFlushCandidates: jest.fn().mockReturnValue([buildRecord({ cycleId: 'cycle-1' })]),
    });
    const postSyncDiagnostics = jest.fn().mockResolvedValue(buildResult());
    const client = { postSyncDiagnostics };

    await flushSyncDiagnosticsOutbox({
      connection: CONNECTION,
      store,
      client,
      config: { isSyncTelemetryEnabled: false },
    });

    // The switch is per-pass: nothing is deleted or deferred while off, so the SAME candidates are eligible again the moment it comes back on.
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
    expect(result).toEqual(tally({ attempted: 1, delivered: 1 }));
  });

  it('behaves exactly as today when the switch is on', async () => {
    const { store, postSyncDiagnostics, result } = await runFlush(
      [buildRecord({ cycleId: 'cycle-1' })],
      [buildResult()],
      { config: { isSyncTelemetryEnabled: true } },
    );

    expect(store.readFlushCandidates).toHaveBeenCalledTimes(1);
    expect(postSyncDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.remove).toHaveBeenCalledWith('cycle-1');
    expect(result).toEqual(tally({ attempted: 1, delivered: 1 }));
  });
});
