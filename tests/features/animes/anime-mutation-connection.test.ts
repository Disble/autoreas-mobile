import { BridgeUnreachableError } from '../../../src/infrastructure/api';
import {
  createDrizzleDb,
  withLocalWrite,
} from '../../../src/infrastructure/db/client/client.helpers';
import {
  applyAnimeMutationPatch,
  buildCapPlusPatch,
} from '../../../src/features/animes/anime-mutation.helpers';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { drainSeasonRatingQueue } from '../../../src/features/sync/season-rating-queue.helpers';
import { runCoordinatedForegroundSyncCycle } from '../../../src/features/sync/sync-facade.helpers';
import {
  recordSyncAttemptFailed,
  recordSyncAttemptStarted,
  recordSyncAttemptSucceeded,
} from '../../../src/features/sync/sync-runtime-status.helpers';
import {
  beginSyncConnectionAttempt,
  getSyncConnectionSnapshot,
  markSyncConnectionSucceeded,
  resetSyncConnectionStore,
} from '../../../src/features/sync/sync-connection-store';

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  createDrizzleDb: jest.fn(),
  withLocalWrite: jest.fn(),
}));

jest.mock('../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

jest.mock('../../../src/features/sync/season-rating-queue.helpers', () => ({
  drainSeasonRatingQueue: jest.fn(),
}));

jest.mock('../../../src/features/sync/sync-runtime-status.helpers', () => ({
  recordSyncAttemptFailed: jest.fn(),
  recordSyncAttemptStarted: jest.fn(),
  recordSyncAttemptSucceeded: jest.fn(),
}));

// Two cases below call `runCoordinatedForegroundSyncCycle` with `source: 'manual'`, which now also
// starts a (non-awaited) cover sweep -- see `tests/features/sync/__tests__/sync-facade.helpers.test.ts`
// for that behavior's own coverage. Mocked here purely so this file's fake `rawDb` never reaches the
// real `DEFAULT_COVER_SWEEP_DEPENDENCIES` in the background.
jest.mock('../../../src/features/sync/cover-sweep/cover-sweep.helpers', () => ({
  runCoverSweep: jest.fn().mockResolvedValue({
    fetched: 0, notModified: 0, absent: 0, unknown: 0, transient: 0, stopped: false,
  }),
}));

/** Shape of the fake drizzle transaction handle `withLocalWrite`'s task callback receives. */
type MockTxDb = {
  update: jest.Mock;
  insert: jest.Mock;
};

/** Fixed clock reading every case in this file computes its expected timestamps relative to. */
const now = 1_710_000_000_000;
/** A dummy raw DB handle: every dependency that would read it is mocked above. */
const rawDb = { name: 'raw-db' };
/** One `animes` row fixture `buildSelectMock` resolves with, for `applyAnimeMutationPatch`'s own read. */
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

/** Builds the fake drizzle `select` chain `createDrizzleDb` returns, resolving `baseAnimeRow`. */
function buildSelectMock() {
  const limit = jest.fn().mockResolvedValue([baseAnimeRow]);
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  return { select };
}

/** Builds the fake `update`/`insert` transaction handle mocks `configureMutationWrite` wires up. */
function createTxDbMocks() {
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));
  const values = jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn(() => ({ values }));

  return {
    txDb: { update, insert } satisfies MockTxDb,
    values,
  };
}

/** Wires `createDrizzleDb`/`withLocalWrite` so a mutation write runs against the fake tx handle. */
function configureMutationWrite(): { readonly values: jest.Mock } {
  const txMocks = createTxDbMocks();
  (createDrizzleDb as jest.Mock).mockReturnValue(buildSelectMock());
  (withLocalWrite as jest.Mock).mockImplementation(
    async (_database, task) => task(txMocks.txDb, rawDb),
  );
  return txMocks;
}

/** Applies one chapter-increment mutation patch to `anime-1`, exercising the real mutation pipeline. */
async function applyChapterIncrement(): Promise<void> {
  await applyAnimeMutationPatch(
    rawDb as never,
    'anime-1',
    buildCapPlusPatch,
    'capPlus',
  );
}

/** Polls a jest mock until it has received at least `expectedCalls` calls, or throws after 20 ticks. */
async function waitForCalls(mock: jest.Mock, expectedCalls: number): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (mock.mock.calls.length >= expectedCalls) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error(`Expected ${expectedCalls} calls, received ${mock.mock.calls.length}`);
}

/** Polls the shared sync connection snapshot until it reaches `expectedKind`, or throws after 20 ticks. */
async function waitForConnectionKind(expectedKind: string): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (getSyncConnectionSnapshot().kind === expectedKind) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error(
    `Expected connection kind ${expectedKind}, received ${getSyncConnectionSnapshot().kind}`,
  );
}

describe('anime mutation connection truth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSyncConnectionStore();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    (syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: 0,
      backlogReadCount: 0,
      hasMorePending: false,
    });
    (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
      deliveredCount: 0,
      backlogReadCount: 0,
      shouldRefreshActiveSeason: false,
      failure: null,
    });
    (recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the local mutation durable but publishes unreachable when background sync rejects', async () => {
    const unreachableError = new BridgeUnreachableError(
      'http://bridge.test/api/sync/reconcile',
      'offline',
    );
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (syncPendingOperations as jest.Mock).mockRejectedValueOnce(unreachableError);
    const successAttempt = beginSyncConnectionAttempt();
    markSyncConnectionSucceeded(successAttempt, now - 1_000);
    const { values } = configureMutationWrite();

    await expect(applyChapterIncrement()).resolves.toBeUndefined();
    await waitForCalls(recordSyncAttemptFailed as jest.Mock, 1);
    await waitForConnectionKind('unreachable');

    expect(getSyncConnectionSnapshot()).toEqual({
      kind: 'unreachable',
      lastSyncAt: now - 1_000,
      message: unreachableError.message,
    });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
  });

  it('prevents an older coordinated success from overwriting a newer chapter failure', async () => {
    const unreachableError = new BridgeUnreachableError(
      'http://bridge.test/api/sync/reconcile',
      'offline',
    );
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const olderAttempt = beginSyncConnectionAttempt();
    (syncPendingOperations as jest.Mock).mockRejectedValueOnce(unreachableError);
    configureMutationWrite();

    await applyChapterIncrement();
    await waitForCalls(recordSyncAttemptFailed as jest.Mock, 1);
    await waitForConnectionKind('unreachable');
    markSyncConnectionSucceeded(olderAttempt, now);

    expect(getSyncConnectionSnapshot()).toEqual({
      kind: 'unreachable',
      lastSyncAt: null,
      message: unreachableError.message,
    });
  });

  it('prevents older facade success telemetry from replacing newer chapter failure diagnostics', async () => {
    type SyncResult = {
      syncedCount: number;
      backlogReadCount: number;
      hasMorePending: boolean;
    };
    let resolveOlderSync!: (value: SyncResult) => void;
    const unreachableError = new BridgeUnreachableError(
      'http://bridge.test/api/sync/reconcile',
      'offline',
    );
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (syncPendingOperations as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise<SyncResult>((resolve) => {
            resolveOlderSync = resolve;
          }),
      )
      .mockRejectedValueOnce(unreachableError);
    const olderFacadePromise = runCoordinatedForegroundSyncCycle({
      rawDb: rawDb as never,
      source: 'manual',
      setActiveSeasonSnapshot: jest.fn(),
    });
    await waitForCalls(syncPendingOperations as jest.Mock, 1);
    configureMutationWrite();

    await applyChapterIncrement();
    await waitForCalls(recordSyncAttemptFailed as jest.Mock, 1);
    resolveOlderSync({ syncedCount: 1, backlogReadCount: 1, hasMorePending: false });
    await expect(olderFacadePromise).resolves.toBe(1);

    expect(recordSyncAttemptFailed).toHaveBeenCalledWith(
      rawDb,
      'local_mutation',
      now,
      unreachableError.message,
    );
    expect(recordSyncAttemptSucceeded).not.toHaveBeenCalled();
    expect(getSyncConnectionSnapshot().kind).toBe('unreachable');
  });

  it('settles a newer chapter failure after an older facade start write already began', async () => {
    const telemetryEvents: string[] = [];
    let resolveOlderStart!: () => void;
    const unreachableError = new BridgeUnreachableError(
      'http://bridge.test/api/sync/reconcile',
      'offline',
    );
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (recordSyncAttemptStarted as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveOlderStart = () => {
            telemetryEvents.push('started');
            resolve();
          };
        }),
    );
    (recordSyncAttemptFailed as jest.Mock).mockImplementationOnce(async () => {
      telemetryEvents.push('failed');
    });
    (syncPendingOperations as jest.Mock)
      .mockRejectedValueOnce(unreachableError)
      .mockResolvedValueOnce({
        syncedCount: 1,
        backlogReadCount: 1,
        hasMorePending: false,
      });
    const olderFacadePromise = runCoordinatedForegroundSyncCycle({
      rawDb: rawDb as never,
      source: 'manual',
      setActiveSeasonSnapshot: jest.fn(),
    });
    await waitForCalls(recordSyncAttemptStarted as jest.Mock, 1);
    configureMutationWrite();

    await applyChapterIncrement();
    resolveOlderStart();
    await expect(olderFacadePromise).resolves.toBe(1);
    await waitForCalls(recordSyncAttemptFailed as jest.Mock, 1);

    expect(telemetryEvents).toEqual(['started', 'failed']);
    expect(getSyncConnectionSnapshot().kind).toBe('unreachable');
  });
});
