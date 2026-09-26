import { act, renderHook } from '@testing-library/react-native';
import { beginChapterAction } from '../../../src/features/animes/chapter-action-diagnostics.helpers';
import { useMutateAnime } from '../../../src/features/animes/use-mutate-anime';
import { isSyncDiagnosticsPayloadAccepted } from '../../../src/features/sync/sync-diagnostics-flush.helpers';
import { animes } from '../../../src/infrastructure/db/schema';
import { EXPO_SQLITE_UNAVAILABLE_MESSAGE } from '../../../src/infrastructure/db/native-runtime/native-runtime.constants';
import type { SyncDiagnosticsOutboxEntry } from '../../../src/infrastructure/db/sync-diagnostics-outbox';

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  createDrizzleDb: jest.fn(),
  withLocalWrite: jest.fn(),
}));

jest.mock('../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

jest.mock('../../../src/features/sync/sync-runtime-status.helpers', () => ({
  recordSyncAttemptFailed: jest.fn().mockResolvedValue(undefined),
}));

// NO STUB OF THE ACCEPTANCE DECISION LIVES HERE ANY MORE. This file used to replace
// `isSyncDiagnosticsPayloadAccepted` with a stub that always answered `true`, because the registry
// carried no chapter kind and the recorder legitimately refused to enqueue one; the phase,
// correlation and duration assertions below would otherwise have had no observations to read.
// `SYNC_DIAGNOSTICS_ACCEPTED_KINDS` now names `episode_action`, so the REAL decision accepts the
// very payload these cases drive and the stub had become a second copy of a fact production
// already states. The registry is read as it ships; the refusal side is pinned by a kind no build
// here names.
// The recorder resolves this store by default, so replacing it in the module registry is what lets
// a case read exactly what the mutation path persisted -- no SQLite file, and no assertion on an
// internal collaborator's call count.
jest.mock(
  '../../../src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants',
  () => ({ syncDiagnosticsOutboxStore: { enqueue: jest.fn() } }),
);

/** SQLite context fake: `useOptionalSQLiteContext` reads through it to decide if writes are possible. */
const { useSQLiteContext: mockUseSQLiteContext } = jest.requireMock('expo-sqlite') as {
  useSQLiteContext: jest.Mock;
};

/** Write-door fakes: the transaction handle and the `withLocalWrite` callback are driven directly. */
const {
  createDrizzleDb: mockCreateDrizzleDb,
  withLocalWrite: mockWithDeferredWrite,
} = jest.requireMock('../../../src/infrastructure/db/client/client.helpers') as {
  createDrizzleDb: jest.Mock;
  withLocalWrite: jest.Mock;
};

/** Controls the fire-and-forget push's outcome after a committed write. */
const { syncPendingOperations: mockSyncPendingOperations } = jest.requireMock(
  '../../../src/features/sync/reconcile.helpers',
) as { syncPendingOperations: jest.Mock };

/** The diagnostics outbox the recorder resolves by default, mocked in the registry above. */
const mockDiagnosticsOutbox = jest.requireMock(
  '../../../src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants',
) as { syncDiagnosticsOutboxStore: { enqueue: jest.Mock } };

/** Shape of the fake drizzle transaction handle `withLocalWrite`'s task callback receives. */
type MockTxDb = {
  update: jest.Mock;
  insert: jest.Mock;
};

/** Fixed clock reading this file's duration expectations are computed against. */
const now = 1_710_000_000_000;
/** A dummy raw DB handle: every dependency that would read it is mocked above. */
const rawDb = { name: 'raw-db' };

/** One `animes` row fixture the fake drizzle select chain resolves with. */
const baseAnimeRow: Record<string, unknown> = {
  _id: 'anime-1',
  nombre: 'One Piece',
  estado: 0,
  nrocapvisto: 3,
  activo: 1,
  primeravez: 0,
  generos: '[]',
  dias: '[]',
  totalcap: null,
  fechaUltCapVisto: null,
  fechaEstreno: null,
  fechaCreacion: null,
  fechaEliminacion: null,
  portada: null,
  pagina: null,
  carpeta: null,
  estudios: null,
  origen: null,
  duracion: null,
  tipo: null,
};

/** Builds the fake drizzle `select` chain `createDrizzleDb` returns for a row that may be absent. */
function buildSelectMock(row: Record<string, unknown> | null) {
  const limit = jest.fn().mockResolvedValue(row ? [row] : []);
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

/** Builds the fake `update`/`insert` transaction handle, optionally failing the insert. */
function createTxDbMocks(options?: { readonly insertError?: Error }) {
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));
  const values = options?.insertError
    ? jest.fn().mockRejectedValue(options.insertError)
    : jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn(() => ({ values }));

  return { txDb: { update, insert } satisfies MockTxDb, update, values, insert };
}

/** Wires `withLocalWrite` so a mutation write runs against the given fake transaction handle. */
function configureMutationWrite(txDb: MockTxDb): void {
  mockWithDeferredWrite.mockImplementation(async (_db, task) => task(txDb, rawDb));
}

/** Reads every observation the mutation path persisted, in write order. */
function readPersistedEntries(): readonly SyncDiagnosticsOutboxEntry[] {
  return mockDiagnosticsOutbox.syncDiagnosticsOutboxStore.enqueue.mock.calls.map(
    (call) => call[0] as SyncDiagnosticsOutboxEntry,
  );
}

/** Parses every persisted observation back into the object that was stored, in write order. */
function readPersistedPayloads(): readonly Record<string, unknown>[] {
  return readPersistedEntries().map(
    (entry) => JSON.parse(entry.payload) as Record<string, unknown>,
  );
}

/** Waits until the recorder has persisted `expectedCount` observations, or fails with the tally. */
async function waitForPersistedCount(expectedCount: number): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (readPersistedEntries().length >= expectedCount) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error(
    `Expected ${expectedCount} persisted observations, received ${readPersistedEntries().length}`,
  );
}

describe('chapter action diagnostics on the mutation path', () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDiagnosticsOutbox.syncDiagnosticsOutboxStore.enqueue.mockReset();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Date, 'now').mockReturnValue(now);
    mockUseSQLiteContext.mockReturnValue(rawDb);
    mockSyncPendingOperations.mockResolvedValue({
      syncedCount: 1,
      backlogReadCount: 1,
      hasMorePending: false,
    });
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('persists skipped/anime_missing when the mutation finds no row to update', async () => {
    mockCreateDrizzleDb.mockReturnValue(buildSelectMock(null));
    const txMocks = createTxDbMocks();
    configureMutationWrite(txMocks.txDb);

    const context = beginChapterAction('capPlus');
    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1', context);
      await waitForPersistedCount(2);
    });

    const payloads = readPersistedPayloads();
    expect(payloads.map((payload) => payload.phase)).toEqual(['received', 'skipped']);
    expect(payloads[1]).toMatchObject({
      action: 'episode_plus_one',
      phase: 'skipped',
      reason: 'anime_missing',
    });
    expect(payloads[1].correlation_id).toBe(payloads[0].correlation_id);
    expect(txMocks.update).not.toHaveBeenCalled();
  });

  it('persists finished/committed with the measured duration, then the sync outcome', async () => {
    mockCreateDrizzleDb.mockReturnValue(buildSelectMock(baseAnimeRow));
    const txMocks = createTxDbMocks();
    configureMutationWrite(txMocks.txDb);

    const context = beginChapterAction('capMinus');
    jest.spyOn(Date, 'now').mockReturnValue(now + 137);
    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capMinus('anime-1', context);
      await waitForPersistedCount(3);
    });

    const payloads = readPersistedPayloads();
    expect(payloads.map((payload) => payload.phase)).toEqual([
      'received',
      'finished',
      'sync',
    ]);
    expect(payloads[1]).toMatchObject({
      action: 'episode_minus_one',
      phase: 'finished',
      outcome: 'committed',
      duration_ms: 137,
    });
    expect(payloads[2]).toMatchObject({ phase: 'sync', outcome: 'ok' });
    expect(payloads[2]).toHaveProperty('duration_ms', null);
    expect(payloads[1].correlation_id).toBe(payloads[0].correlation_id);
    expect(payloads[2].correlation_id).toBe(payloads[0].correlation_id);
    // The wire id and the outbox row id are the same value on every observation, which is what
    // makes a re-post of the stored body idempotent on the bridge's side.
    expect(readPersistedEntries().map((entry) => entry.cycleId)).toEqual(
      payloads.map((payload) => payload.observation_id),
    );
    expect(txMocks.update).toHaveBeenCalledWith(animes);
  });

  it('persists finished/failed with the closed cause when the local write throws', async () => {
    const insertError = new Error('database is locked');
    mockCreateDrizzleDb.mockReturnValue(buildSelectMock(baseAnimeRow));
    const txMocks = createTxDbMocks({ insertError });
    configureMutationWrite(txMocks.txDb);

    const context = beginChapterAction('capPlusHalf');
    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await expect(result.current.capPlusHalf('anime-1', context)).rejects.toThrow(insertError);
      await waitForPersistedCount(2);
    });

    const payloads = readPersistedPayloads();
    expect(payloads.map((payload) => payload.phase)).toEqual(['received', 'finished']);
    expect(payloads[1]).toMatchObject({
      action: 'episode_plus_half',
      phase: 'finished',
      outcome: 'failed',
      cause: 'lock_contention',
    });
    expect(JSON.stringify(payloads[1])).not.toContain('database is locked');
  });

  it('persists sync/failed when the post-write push rejects, keeping the commit recorded', async () => {
    mockCreateDrizzleDb.mockReturnValue(buildSelectMock(baseAnimeRow));
    const txMocks = createTxDbMocks();
    configureMutationWrite(txMocks.txDb);
    mockSyncPendingOperations.mockRejectedValueOnce(new Error('network request failed'));

    const context = beginChapterAction('capMinusHalf');
    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capMinusHalf('anime-1', context);
      await waitForPersistedCount(3);
    });

    const payloads = readPersistedPayloads();
    expect(payloads.map((payload) => payload.phase)).toEqual([
      'received',
      'finished',
      'sync',
    ]);
    expect(payloads[1]).toMatchObject({ outcome: 'committed' });
    expect(payloads[2]).toMatchObject({ phase: 'sync', outcome: 'failed' });
  });

  it('persists skipped/db_unavailable and still rethrows when no SQLite context exists', async () => {
    mockUseSQLiteContext.mockReturnValue(null);

    const context = beginChapterAction('capPlus');
    const { result } = renderHook(() => useMutateAnime());

    let thrown: unknown = undefined;
    await act(async () => {
      thrown = await result.current
        .capPlus('anime-1', context)
        .then(() => undefined, (error: unknown) => error);
    });

    // The error crosses this layer untouched: the caller still decides how to surface it, and a
    // diagnostic that replaced it would turn a visible failure into a silent one.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(EXPO_SQLITE_UNAVAILABLE_MESSAGE);

    // No write door was ever opened, so the local write is neither committed nor failed: the feed
    // must say so instead of leaving the tap as a `received` with no terminal observation.
    const payloads = readPersistedPayloads();
    expect(payloads.map((payload) => payload.phase)).toEqual(['received', 'skipped']);
    expect(payloads[1]).toMatchObject({
      action: 'episode_plus_one',
      phase: 'skipped',
      reason: 'db_unavailable',
    });
    expect(payloads[1].correlation_id).toBe(payloads[0].correlation_id);
    expect(mockCreateDrizzleDb).not.toHaveBeenCalled();
    expect(mockWithDeferredWrite).not.toHaveBeenCalled();
  });

  it('leaves the mutation result untouched when the outbox cannot be written', async () => {
    mockCreateDrizzleDb.mockReturnValue(buildSelectMock(baseAnimeRow));
    const txMocks = createTxDbMocks();
    configureMutationWrite(txMocks.txDb);
    mockDiagnosticsOutbox.syncDiagnosticsOutboxStore.enqueue.mockImplementation(() => {
      throw new Error('sqlite unavailable');
    });

    const context = beginChapterAction('capPlus');
    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await expect(result.current.capPlus('anime-1', context)).resolves.toBeUndefined();
    });

    expect(mockDiagnosticsOutbox.syncDiagnosticsOutboxStore.enqueue).toHaveBeenCalled();
    expect(txMocks.update).toHaveBeenCalledWith(animes);
    expect(txMocks.insert).toHaveBeenCalled();
  });

  it('enqueues nothing for a tap whose switch is off, and still commits the write', async () => {
    mockCreateDrizzleDb.mockReturnValue(buildSelectMock(baseAnimeRow));
    const txMocks = createTxDbMocks();
    configureMutationWrite(txMocks.txDb);

    const context = beginChapterAction('capPlus', { isTelemetryEnabled: false });
    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1', context);
      await Promise.resolve();
    });

    // Zero observations, including the `received` the tap boundary emits and the `sync` the
    // fire-and-forget push would append: powering the switch off must not leave a partial thread.
    expect(readPersistedEntries()).toHaveLength(0);
    // The user's own write is untouched: the switch is a diagnostics flag, never a mutation gate.
    expect(txMocks.update).toHaveBeenCalledWith(animes);
    expect(txMocks.insert).toHaveBeenCalled();
    expect(mockSyncPendingOperations).toHaveBeenCalled();
  });

  it('enqueues nothing for a tap dropped with no SQLite context while the switch is off', async () => {
    mockUseSQLiteContext.mockReturnValue(null);

    const context = beginChapterAction('capPlus', { isTelemetryEnabled: false });
    const { result } = renderHook(() => useMutateAnime());

    let thrown: unknown = undefined;
    await act(async () => {
      thrown = await result.current
        .capPlus('anime-1', context)
        .then(() => undefined, (error: unknown) => error);
    });

    expect(readPersistedEntries()).toHaveLength(0);
    // The missing-database error still crosses this layer untouched.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(EXPO_SQLITE_UNAVAILABLE_MESSAGE);
  });

  it('persists every phase of a tap now that the registry serves the chapter kind, without touching the write', async () => {
    // CONTRACT CORRECTION, not an inversion to make a red test green: this case used to assert that
    // the whole path stayed off the wire, because the registry carried no chapter kind and the
    // flush deletes a body its 400 condemns. The registry now names the kind the bridge serves
    // (v1.15.0), so the same tap persists the receipt, the commit and the post-write sync outcome.
    // The mutation itself is still never gated by a diagnostics decision.
    mockCreateDrizzleDb.mockReturnValue(buildSelectMock(baseAnimeRow));
    const txMocks = createTxDbMocks();
    configureMutationWrite(txMocks.txDb);

    const context = beginChapterAction('capPlus');
    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1', context);
      await waitForPersistedCount(3);
    });

    const payloads = readPersistedPayloads();
    expect(payloads.map((payload) => payload.phase)).toEqual(['received', 'finished', 'sync']);
    expect(payloads[0]).toMatchObject({
      kind: 'episode_action',
      action: 'episode_plus_one',
      phase: 'received',
      duration_ms: null,
    });
    expect(payloads[2]).toMatchObject({ phase: 'sync', outcome: 'ok', duration_ms: null });
    expect(txMocks.update).toHaveBeenCalledWith(animes);
    expect(txMocks.insert).toHaveBeenCalled();
    expect(mockSyncPendingOperations).toHaveBeenCalled();

    // The admission is the REGISTRY's, not a blanket yes: the decision as it ships accepts the kind
    // the recorder now emits, and still refuses a kind no build here names.
    expect(isSyncDiagnosticsPayloadAccepted({ kind: 'episode_action' })).toBe(true);
    expect(isSyncDiagnosticsPayloadAccepted({ kind: 'watch_session' })).toBe(false);
  });
});
