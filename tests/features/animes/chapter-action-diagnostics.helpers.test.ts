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
});
