import type {
  SyncDiagnosticsOutboxEntry,
  SyncDiagnosticsOutboxStore,
} from '../../../src/infrastructure/db/sync-diagnostics-outbox';
import {
  beginChapterAction,
  recordChapterActionCommitted,
  recordChapterActionFailed,
  recordChapterActionSkipped,
  recordChapterActionSync,
} from '../../../src/features/animes/chapter-action-diagnostics.helpers';
import type {
  ChapterActionSkippedReason,
  ChapterActionSyncOutcome,
} from '../../../src/features/animes/chapter-action-diagnostics.types';

/**
 * The acceptance decision the recorder consults, stubbed to ACCEPT the chapter kind by default.
 *
 * The bridge does not declare this kind yet, so every payload-contract case below -- the privacy
 * allowlist, the closed vocabulary, the phase-specific fields, the shared correlation id -- would
 * otherwise have no payload left to assert on, and the builder that the bridge will start reading
 * the day the registry flips would sit unguarded until then. Stubbing the DECISION keeps those
 * assertions driving the real builder, while the case that pins today's registry (the last one in
 * this file) re-arms the real decision and proves the recorder obeys it.
 */
jest.mock('../../../src/features/sync/sync-diagnostics-flush.helpers', () => {
  const actual = jest.requireActual('../../../src/features/sync/sync-diagnostics-flush.helpers') as {
    readonly isSyncDiagnosticsPayloadAccepted: (payload: unknown) => boolean;
  };

  return { ...actual, isSyncDiagnosticsPayloadAccepted: jest.fn(() => true) };
});

/** The acceptance decision as it actually ships, read from the real module this file replaces. */
const actualIsSyncDiagnosticsPayloadAccepted = (
  jest.requireActual('../../../src/features/sync/sync-diagnostics-flush.helpers') as {
    readonly isSyncDiagnosticsPayloadAccepted: (payload: unknown) => boolean;
  }
).isSyncDiagnosticsPayloadAccepted;

/** The stub of that decision which the recorder actually consults in this suite. */
const mockIsSyncDiagnosticsPayloadAccepted = (
  jest.requireMock('../../../src/features/sync/sync-diagnostics-flush.helpers') as {
    isSyncDiagnosticsPayloadAccepted: jest.Mock;
  }
).isSyncDiagnosticsPayloadAccepted;

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

describe('chapter action diagnostics', () => {
  beforeEach(() => {
    // Re-armed for every case: `jest.restoreAllMocks` would otherwise leave the stub answering
    // `undefined`, and the gate case's real decision must not leak into the payload cases. The
    // bridge-accepts-this-kind world is what keeps the payload assertions below meaningful.
    mockIsSyncDiagnosticsPayloadAccepted.mockReturnValue(true);
  });

  it('records one received observation naming the wire action', () => {
    const store = createCapturingStore();

    beginChapterAction('capPlusHalf', { store, now: () => fixedNow, generateId: () => 'obs-1' });

    expect(store.entries).toHaveLength(1);
    expect(parsePayload(store.entries[0])).toEqual({
      kind: 'chapter_action',
      action: 'cap_plus_half',
      phase: 'received',
      correlation_id: 'obs-1',
      at: fixedNow,
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
      action: 'cap_minus',
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
      action: 'cap_plus',
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
    expect(payload).not.toHaveProperty('duration_ms');
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
      'at',
      'correlation_id',
      'duration_ms',
      'kind',
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

  it('enqueues nothing for any phase while the bridge does not accept the chapter kind', () => {
    // The bridge strict-decodes this endpoint with `DisallowUnknownFields()` and answers 400 for a
    // `kind` it does not declare, and the flush reads 400 as "this body is malformed forever" and
    // deletes the row. So the recorder must not create one in the first place: with the registry
    // as it ships, EVERY phase is silent -- the receipt, the skip, the commit, the failure and the
    // post-write sync outcome. The action still opens and still carries its correlation id, because
    // the mutation path depends on that context whether or not anything is being recorded.
    mockIsSyncDiagnosticsPayloadAccepted.mockImplementation(actualIsSyncDiagnosticsPayloadAccepted);
    const store = createCapturingStore();
    const params = { store, now: () => fixedNow, generateId: () => 'obs' };

    const context = beginChapterAction('capPlus', params);
    recordChapterActionCommitted(context, params);
    recordChapterActionSkipped(context, 'anime_missing', params);
    recordChapterActionFailed(context, new Error('database is locked'), params);
    recordChapterActionSync(context, 'ok', params);

    expect(store.entries).toHaveLength(0);
    expect(context.correlationId).toBe('obs');
  });
});
