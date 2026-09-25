import type {
  SyncDiagnosticsOutboxEntry,
  SyncDiagnosticsOutboxStore,
} from '../../../src/infrastructure/db/sync-diagnostics-outbox';
import {
  beginChapterAction,
  buildChapterActionWirePayload,
  recordChapterActionCommitted,
  recordChapterActionFailed,
  recordChapterActionSkipped,
  recordChapterActionSync,
} from '../../../src/features/animes/chapter-action-diagnostics.helpers';
import { isSyncDiagnosticsPayloadAccepted } from '../../../src/features/sync/sync-diagnostics-flush.helpers';
import type {
  ChapterActionContext,
  ChapterActionObservation,
  ChapterActionOutcome,
  ChapterActionSkippedReason,
  ChapterActionSyncOutcome,
  ChapterActionWirePayload,
} from '../../../src/features/animes/chapter-action-diagnostics.types';

// NO STUB OF THE ACCEPTANCE DECISION LIVES HERE ANY MORE. This file used to replace
// `isSyncDiagnosticsPayloadAccepted` with a stub that always answered `true`, because the registry
// carried no chapter kind and the recorder legitimately refused to enqueue one; every payload case
// below would otherwise have had nothing to assert on. `SYNC_DIAGNOSTICS_ACCEPTED_KINDS` now names
// `episode_action`, so the REAL decision accepts the very payload these cases drive: the stub had
// become a second copy of a fact production already states, hiding the real gate behind a
// replacement of it. The registry is read as it ships, and the refusal side is pinned from the
// other direction by a kind no build here names.
/** A store that keeps what the recorder persisted, so a case can read the wire payload itself. */
type CapturingStore = Pick<SyncDiagnosticsOutboxStore, 'enqueue'> & {
  readonly entries: SyncDiagnosticsOutboxEntry[];
};

/** Builds the capturing store above with an empty entry list, one per case. */
function createCapturingStore(): CapturingStore {
  const entries: SyncDiagnosticsOutboxEntry[] = [];

  return {
    entries,
    enqueue: (entry) => {
      entries.push(entry);
    },
  };
}

/** Parses one persisted entry back into the object that was stored. */
function parsePayload(entry: SyncDiagnosticsOutboxEntry): Record<string, unknown> {
  return JSON.parse(entry.payload) as Record<string, unknown>;
}

/** Fixed clock reading every expected timestamp in this file is computed against. */
const fixedNow = 1710000000000;

/** The correlation id every directly-built payload carries. */
const fixedCorrelationId = 'correlation';

/** The observation id every directly-built payload carries, absent a case about the id itself. */
const fixedObservationId = 'observation';

/** A context for driving the builder directly, keyed to one action and a fixed correlation id. */
function createContext(overrides: Partial<ChapterActionContext> = {}): ChapterActionContext {
  return {
    action: 'capPlus',
    correlationId: fixedCorrelationId,
    startedAt: fixedNow,
    isTelemetryEnabled: true,
    ...overrides,
  };
}

/**
 * Builds one payload straight through the exported builder.
 *
 * This is the only way to reach the phase and field combinations the four recorders are designed
 * never to produce -- a cause on a committed write, a reason off a skip, a duration off a finished
 * write -- and those are exactly the bodies the bridge rejects rather than ignores, so they have to
 * be pinned somewhere. The context follows the observation's action so the action guard never
 * masks the rule a case is actually about.
 */
function buildPayload(
  observation: ChapterActionObservation,
  observedAtMs: number = fixedNow,
): ChapterActionWirePayload | null {
  return buildChapterActionWirePayload(
    createContext({ action: observation.action }),
    observation,
    observedAtMs,
    fixedObservationId,
  );
}

/** Reads a payload's own keys in sorted order, so a key-set assertion reads as a set. */
function payloadKeys(payload: ChapterActionWirePayload | null): string[] {
  return Object.keys(payload ?? {}).sort();
}

describe('chapter action diagnostics', () => {
  it('records one received observation naming the wire action', () => {
    const store = createCapturingStore();
    const ids = ['correlation', 'outbox-received'];

    beginChapterAction('capPlusHalf', {
      store,
      now: () => fixedNow,
      generateId: () => ids.shift() as string,
    });

    expect(store.entries).toHaveLength(1);
    expect(parsePayload(store.entries[0])).toEqual({
      kind: 'episode_action',
      observation_id: 'outbox-received',
      action: 'episode_plus_half',
      phase: 'received',
      observed_at_ms: fixedNow,
      correlation_id: 'correlation',
      duration_ms: null,
    });
  });

  it('gives every observation its own outbox id while sharing one correlation id', () => {
    const store = createCapturingStore();
    const ids = ['correlation', 'outbox-received', 'outbox-finished'];
    const generateId = () => ids.shift() as string;

    const context = beginChapterAction('capMinus', { store, now: () => fixedNow, generateId });
    recordChapterActionCommitted(context, { store, now: () => fixedNow + 40, generateId });

    expect(store.entries.map((entry) => entry.cycleId)).toEqual([
      'outbox-received',
      'outbox-finished',
    ]);
    // The wire id IS the row id: a stored body re-posted after a restart carries the idempotency
    // key the bridge deduplicates on, and there is no second id that could disagree with it.
    expect(store.entries.map((entry) => parsePayload(entry).observation_id)).toEqual([
      'outbox-received',
      'outbox-finished',
    ]);
    expect(parsePayload(store.entries[0]).correlation_id).toBe('correlation');
    expect(parsePayload(store.entries[1]).correlation_id).toBe('correlation');
  });

  it('measures the local write duration between receipt and commit', () => {
    const store = createCapturingStore();
    const context = beginChapterAction('capPlus', { store, now: () => fixedNow, generateId: () => 'a' });

    recordChapterActionCommitted(context, { store, now: () => fixedNow + 137, generateId: () => 'b' });

    expect(parsePayload(store.entries[1])).toMatchObject({
      phase: 'finished',
      outcome: 'committed',
      duration_ms: 137,
    });
  });

  it('records a closed reason when the action is dropped instead of mutated', () => {
    const store = createCapturingStore();
    const context = beginChapterAction('capMinus', { store, now: () => fixedNow, generateId: () => 'a' });

    recordChapterActionSkipped(context, 'in_flight', { store, now: () => fixedNow, generateId: () => 'b' });

    expect(parsePayload(store.entries[1])).toMatchObject({
      action: 'episode_minus_one',
      phase: 'skipped',
      reason: 'in_flight',
    });
  });

  it('accepts the db_unavailable reason, so a missing database is not reported as a failure', () => {
    const store = createCapturingStore();
    const context = beginChapterAction('capPlus', { store, now: () => fixedNow, generateId: () => 'a' });

    recordChapterActionSkipped(context, 'db_unavailable', {
      store,
      now: () => fixedNow,
      generateId: () => 'b',
    });

    expect(parsePayload(store.entries[1])).toMatchObject({
      action: 'episode_plus_one',
      phase: 'skipped',
      reason: 'db_unavailable',
    });
  });

  it('falls back to the closed unknown cause when a failure carries no classifiable error', () => {
    const store = createCapturingStore();
    const context = beginChapterAction('capPlus', { store, now: () => fixedNow, generateId: () => 'a' });

    recordChapterActionFailed(context, null, { store, now: () => fixedNow + 5, generateId: () => 'b' });

    expect(parsePayload(store.entries[1])).toMatchObject({
      phase: 'finished',
      outcome: 'failed',
      cause: 'unknown',
    });
  });

  it('records the post-write sync outcome without inventing a duration', () => {
    const store = createCapturingStore();
    const context = beginChapterAction('capPlus', { store, now: () => fixedNow, generateId: () => 'a' });

    recordChapterActionSync(context, 'failed', { store, now: () => fixedNow + 9, generateId: () => 'b' });

    const payload = parsePayload(store.entries[1]);
    expect(payload).toMatchObject({ phase: 'sync', outcome: 'failed' });
    // Present and null, never omitted: the bridge declares `duration_ms` on EVERY body and reads a
    // non-null value on this phase as a rejection, so "not applicable" has to be said out loud.
    expect(payload).toHaveProperty('duration_ms', null);
  });

  it('never forwards a value outside the closed vocabulary', () => {
    const store = createCapturingStore();
    const context = beginChapterAction('capPlus', { store, now: () => fixedNow, generateId: () => 'a' });

    recordChapterActionSkipped(
      context,
      'because_the_user_was_confused' as unknown as ChapterActionSkippedReason,
      { store, now: () => fixedNow, generateId: () => 'b' },
    );
    recordChapterActionSync(
      context,
      'probably' as unknown as ChapterActionSyncOutcome,
      { store, now: () => fixedNow, generateId: () => 'c' },
    );

    expect(store.entries).toHaveLength(1);
  });

  it('sends only allowlisted fields, so no anime identity or free text can travel', () => {
    const store = createCapturingStore();
    const context = beginChapterAction('capMinusHalf', {
      store,
      now: () => fixedNow,
      generateId: () => 'a',
    });

    recordChapterActionCommitted(context, { store, now: () => fixedNow, generateId: () => 'b' });

    expect(Object.keys(parsePayload(store.entries[1])).sort()).toEqual([
      'action',
      'correlation_id',
      'duration_ms',
      'kind',
      'observation_id',
      'observed_at_ms',
      'outcome',
      'phase',
    ]);
  });

  it('stays silent instead of throwing when the outbox cannot be written', () => {
    const store: Pick<SyncDiagnosticsOutboxStore, 'enqueue'> = {
      enqueue: () => {
        throw new Error('sqlite unavailable');
      },
    };

    expect(() =>
      beginChapterAction('capPlus', { store, now: () => fixedNow, generateId: () => 'a' }),
    ).not.toThrow();
  });

  it('enqueues nothing at all for an action whose switch is off', () => {
    // The declared contract (database.schema.ts:113-115) is "stops the payload from being built
    // or sent at all": no phase may survive the switch, not even the receipt that carries no
    // anime identity -- a queued row is a row that will be POSTed later.
    const store = createCapturingStore();
    const params = {
      store,
      now: () => fixedNow,
      generateId: () => 'obs',
      isTelemetryEnabled: false,
    };

    const context = beginChapterAction('capPlus', params);
    recordChapterActionCommitted(context, params);
    recordChapterActionSkipped(context, 'anime_missing', params);
    recordChapterActionFailed(context, new Error('database is locked'), params);
    recordChapterActionSync(context, 'ok', params);

    expect(store.entries).toHaveLength(0);
  });

  it('records exactly the same phases as before when the switch is explicitly on', () => {
    const store = createCapturingStore();
    const params = {
      store,
      now: () => fixedNow,
      generateId: () => 'obs',
      isTelemetryEnabled: true,
    };

    const context = beginChapterAction('capMinus', params);
    recordChapterActionSync(context, 'failed', params);

    expect(store.entries).toHaveLength(2);
    expect(parsePayload(store.entries[0]).phase).toBe('received');
    expect(parsePayload(store.entries[1])).toMatchObject({ phase: 'sync', outcome: 'failed' });
  });

  it('resolves the switch once per action, so a later phase cannot resurrect a muted action', () => {
    const store = createCapturingStore();

    const context = beginChapterAction('capPlusHalf', {
      store,
      now: () => fixedNow,
      generateId: () => 'obs',
      isTelemetryEnabled: false,
    });
    recordChapterActionCommitted(context, {
      store,
      now: () => fixedNow + 10,
      generateId: () => 'obs-later',
      isTelemetryEnabled: true,
    });

    expect(store.entries).toHaveLength(0);
  });

  it('treats an absent switch value as enabled, mirroring the persisted-preference default', () => {
    const store = createCapturingStore();

    beginChapterAction('capPlus', { store, now: () => fixedNow, generateId: () => 'obs' });

    expect(store.entries).toHaveLength(1);
  });

  describe('the frozen wire contract', () => {
    /**
     * The keys every body carries before its phase-specific ones, spread into each expected payload
     * rather than repeated, so every case still asserts the WHOLE body.
     */
    const sharedKeys = {
      kind: 'episode_action',
      observation_id: fixedObservationId,
      action: 'episode_plus_one',
      observed_at_ms: fixedNow,
      correlation_id: fixedCorrelationId,
    } as const;

    /** Every body the contract declares: its name, its observation, the clock, and its payload. */
    const declared: (readonly [string, ChapterActionObservation, number, ChapterActionWirePayload])[] = [
      ['a receipt', { action: 'capPlus', phase: 'received' }, fixedNow, { ...sharedKeys, phase: 'received', duration_ms: null }],
      ['a skip', { action: 'capPlus', phase: 'skipped', reason: 'in_flight' }, fixedNow, { ...sharedKeys, phase: 'skipped', reason: 'in_flight', duration_ms: null }],
      ['a committed write', { action: 'capPlus', phase: 'finished', outcome: 'committed' }, fixedNow + 137, { ...sharedKeys, phase: 'finished', observed_at_ms: fixedNow + 137, outcome: 'committed', duration_ms: 137 }],
      ['a failed write', { action: 'capPlus', phase: 'finished', outcome: 'failed', cause: 'lock_contention' }, fixedNow + 137, { ...sharedKeys, phase: 'finished', observed_at_ms: fixedNow + 137, outcome: 'failed', cause: 'lock_contention', duration_ms: 137 }],
      ['a sync result', { action: 'capPlus', phase: 'sync', outcome: 'ok' }, fixedNow, { ...sharedKeys, phase: 'sync', outcome: 'ok', duration_ms: null }],
    ];

    /** Reads the outcome the builder accepted for one observation, or undefined when it refused. */
    const outcomeOf = (observation: ChapterActionObservation) =>
      buildPayload(observation)?.outcome;

    it('emits exactly the declared key set for every phase it accepts', () => {
      expect(
        declared.map(([name, observation, observedAtMs]) => [name, buildPayload(observation, observedAtMs)]),
      ).toEqual(declared.map(([name, , , payload]) => [name, payload]));
    });

    it('states duration_ms on every body, null wherever a duration does not apply', () => {
      // Verbatim keys for one body as well, because an OMITTED `duration_ms` reads as `undefined`
      // and would slip past a value-only assertion -- and omission is the body the bridge rejects.
      expect(payloadKeys(buildPayload({ action: 'capPlus', phase: 'sync', outcome: 'ok' }))).toEqual([
        'action', 'correlation_id', 'duration_ms', 'kind', 'observation_id', 'observed_at_ms', 'outcome', 'phase',
      ]);
      expect(
        declared.map(([name, observation, observedAtMs]) => [name, buildPayload(observation, observedAtMs)?.duration_ms]),
      ).toEqual([
        ['a receipt', null], ['a skip', null], ['a committed write', 137], ['a failed write', 137], ['a sync result', null],
      ]);
    });

    it('names all four gestures with the bridge episode tokens', () => {
      const tokens = (['capPlus', 'capMinus', 'capPlusHalf', 'capMinusHalf'] as const).map(
        (action) => buildPayload({ action, phase: 'received' })?.action,
      );

      expect(tokens).toEqual([
        'episode_plus_one',
        'episode_minus_one',
        'episode_plus_half',
        'episode_minus_half',
      ]);
    });

    it('accepts the outcome each phase declares, `failed` included on both of them', () => {
      expect(outcomeOf({ action: 'capPlus', phase: 'finished', outcome: 'committed' })).toBe('committed');
      expect(
        outcomeOf({ action: 'capPlus', phase: 'finished', outcome: 'failed', cause: 'lock_contention' }),
      ).toBe('failed');
      expect(outcomeOf({ action: 'capPlus', phase: 'sync', outcome: 'ok' })).toBe('ok');
      expect(outcomeOf({ action: 'capPlus', phase: 'sync', outcome: 'failed' })).toBe('failed');
    });

    /**
     * Bodies the contract does not declare, each named by the rule that refuses it.
     *
     * Every one of these is a rejection on the bridge's side rather than something it ignores, and
     * every one is reachable only through a cast: the four recorders cannot express them, which is
     * exactly why the rules are pinned here. The two names carrying an outcome from the OTHER phase
     * are the decisive pair for the pairing rule -- `failed` is the token both vocabularies share,
     * so only a token one phase alone declares can tell a phase-conditioned rule apart from one
     * that simply reads both vocabularies together.
     */
    const refused: readonly (readonly [string, ChapterActionObservation])[] = [
      ['committed on a sync', { action: 'capPlus', phase: 'sync', outcome: 'committed' as unknown as ChapterActionOutcome }],
      ['ok on a finished write', { action: 'capPlus', phase: 'finished', outcome: 'ok' as unknown as ChapterActionOutcome }],
      ['an outcome on a receipt', { action: 'capPlus', phase: 'received', outcome: 'committed' as unknown as ChapterActionOutcome }],
      ['an outcome on a skip', { action: 'capPlus', phase: 'skipped', reason: 'in_flight', outcome: 'ok' as unknown as ChapterActionOutcome }],
      ['a cause on a committed write', { action: 'capPlus', phase: 'finished', outcome: 'committed', cause: 'lock_contention' }],
      ['a cause on a receipt', { action: 'capPlus', phase: 'received', cause: 'lock_contention' }],
      ['a cause on a skip', { action: 'capPlus', phase: 'skipped', reason: 'in_flight', cause: 'lock_contention' }],
      ['a cause on a sync result', { action: 'capPlus', phase: 'sync', outcome: 'failed', cause: 'lock_contention' }],
      ['a reason on a receipt', { action: 'capPlus', phase: 'received', reason: 'in_flight' }],
      ['a reason on a finished write', { action: 'capPlus', phase: 'finished', outcome: 'committed', reason: 'in_flight' }],
      ['a reason on a sync result', { action: 'capPlus', phase: 'sync', outcome: 'ok', reason: 'in_flight' }],
      ['a skip with no reason at all', { action: 'capPlus', phase: 'skipped' }],
      ['an undeclared skip reason', { action: 'capPlus', phase: 'skipped', reason: 'user_confusion' as unknown as ChapterActionSkippedReason }],
      ['a duration on a receipt', { action: 'capPlus', phase: 'received', durationMs: 5 }],
      ['a duration on a skip', { action: 'capPlus', phase: 'skipped', reason: 'in_flight', durationMs: 5 }],
      ['a duration on a sync result', { action: 'capPlus', phase: 'sync', outcome: 'ok', durationMs: 5 }],
      ['a negative finished duration', { action: 'capPlus', phase: 'finished', outcome: 'committed', durationMs: -1 }],
      ['a non-numeric finished duration', { action: 'capPlus', phase: 'finished', outcome: 'committed', durationMs: Number.NaN }],
      ['an undeclared outcome', { action: 'capPlus', phase: 'finished', outcome: 'maybe' as unknown as ChapterActionOutcome, cause: 'lock_contention' }],
      ['an undeclared cause', { action: 'capPlus', phase: 'finished', outcome: 'failed', cause: 'disk_on_fire' as unknown as ChapterActionObservation['cause'] }],
    ];

    it('refuses every body it does not declare, instead of repairing or forwarding it', () => {
      expect(refused.map(([rule, observation]) => [rule, buildPayload(observation)])).toEqual(
        refused.map(([rule]) => [rule, null]),
      );
    });
  });

  it('enqueues every phase now that the registry serves the chapter kind, and still refuses a kind it does not name', () => {
    // CONTRACT CORRECTION, not an inversion to make a red test green: this case used to assert that
    // EVERY phase stayed silent, because `SYNC_DIAGNOSTICS_ACCEPTED_KINDS` carried no chapter kind
    // and the recorder refuses to create a row the flush would delete on its first 400. The
    // registry now names the kind the bridge serves (v1.15.0), so the same five calls produce the
    // five real observations -- and the gate itself stays pinned from the other side, on a kind
    // this build still does not name.
    const store = createCapturingStore();
    const params = { store, now: () => fixedNow, generateId: () => 'obs' };

    const context = beginChapterAction('capPlus', params);
    recordChapterActionCommitted(context, params);
    recordChapterActionSkipped(context, 'anime_missing', params);
    recordChapterActionFailed(context, new Error('database is locked'), params);
    recordChapterActionSync(context, 'ok', params);

    // The whole action, in order, through the REAL registry: the receipt, the commit, the drop, the
    // failure and the post-write sync outcome all reach the outbox now.
    expect(store.entries.map((entry) => parsePayload(entry).phase)).toEqual([
      'received',
      'finished',
      'skipped',
      'finished',
      'sync',
    ]);
    expect(parsePayload(store.entries[2])).toMatchObject({
      kind: 'episode_action',
      action: 'episode_plus_one',
      phase: 'skipped',
      reason: 'anime_missing',
      correlation_id: 'obs',
    });
    expect(context.correlationId).toBe('obs');

    // And the admission is the REGISTRY's decision, never a blanket yes: the decision as it ships
    // accepts the kind this build now emits AND the kindless legacy cycle envelope, whose absence
    // of `kind` is the frozen rule, and still refuses a kind no build here names.
    expect(isSyncDiagnosticsPayloadAccepted({ kind: 'episode_action' })).toBe(true);
    expect(isSyncDiagnosticsPayloadAccepted({ cycle_id: 'cycle-1' })).toBe(true);
    expect(isSyncDiagnosticsPayloadAccepted({ kind: 'watch_session' })).toBe(false);
  });
});
