import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, renderHook } from '@testing-library/react-native';
import { animes, operationLog } from '../../../src/infrastructure/db/schema';
import { useMutateAnime } from '../../../src/features/animes/use-mutate-anime';

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  createDrizzleDb: jest.fn(),
  withLocalWrite: jest.fn(),
}));

// The kick after a mutation is a flush request; the cycle it runs has its own tests.
jest.mock('../../../src/features/sync/sync-flush.helpers', () => ({
  requestFlush: jest.fn().mockResolvedValue(0),
}));

jest.mock('../../../src/features/sync/sync-runtime-status.helpers', () => ({
  recordSyncAttemptFailed: jest.fn().mockResolvedValue(undefined),
}));

/** Failure telemetry fake: the write-failure cases assert what reaches it. */
const { recordSyncAttemptFailed: mockRecordSyncAttemptFailed } = jest.requireMock(
  '../../../src/features/sync/sync-runtime-status.helpers'
) as { recordSyncAttemptFailed: jest.Mock };

/** SQLite context fake the hook reads its database from. */
const { useSQLiteContext: mockUseSQLiteContext } = jest.requireMock('expo-sqlite') as {
  useSQLiteContext: jest.Mock;
};

/** Write-door fakes: the select chain and the `withLocalWrite` callback are driven directly. */
const {
  createDrizzleDb: mockCreateDrizzleDb,
  withLocalWrite: mockWithDeferredWrite,
} = jest.requireMock('../../../src/infrastructure/db/client/client.helpers') as {
  createDrizzleDb: jest.Mock;
  withLocalWrite: jest.Mock;
};

/** Shape of the fake drizzle transaction handle `withLocalWrite`'s task callback receives. */
type MockTxDb = {
  update: jest.Mock;
  insert: jest.Mock;
};

/** Fixed clock reading every expected timestamp is computed against. */
const now = 1710000000000;
/** A dummy raw DB handle: every dependency that would read it is mocked above. */
const rawDb = { name: 'raw-db' };

/** One `animes` row fixture the fake select chain resolves with. */
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

/** Builds the fake drizzle `select` chain, resolving `row` (or nothing). */
function buildSelectMock(row: Record<string, unknown> | null) {
  const limit = jest.fn().mockResolvedValue(row ? [row] : []);
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  return { select, from, where, limit };
}

/** Builds the fake `update`/`insert` transaction handle, optionally failing the insert. */
function createTxDbMocks(options?: { insertError?: Error }) {
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));
  const values = options?.insertError
    ? jest.fn().mockRejectedValue(options.insertError)
    : jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn(() => ({ values }));

  return {
    txDb: { update, insert } satisfies MockTxDb,
    where,
    set,
    update,
    values,
    insert,
  };
}

/** Runs every `withLocalWrite` task against `txDb`. */
function mockAnimeDeferredWrite(txDb: MockTxDb) {
  mockWithDeferredWrite.mockImplementation(async (_db, task) => task(txDb, rawDb));
}

describe('useMutateAnime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    mockUseSQLiteContext.mockReturnValue(rawDb);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('capPlus lee el estado actual de SQLite, actualiza el anime y crea operation_log pendiente', async () => {
    const selectMock = buildSelectMock(baseAnimeRow);
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1');
    });

    expect(mockCreateDrizzleDb).toHaveBeenCalledWith(rawDb);
    expect(selectMock.select).toHaveBeenCalled();
    expect(mockWithDeferredWrite).toHaveBeenCalledWith(rawDb, expect.any(Function));
    expect(txMocks.update).toHaveBeenCalledWith(animes);
    expect(txMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 4,
      fechaUltCapVisto: now,
    });
    expect(txMocks.insert).toHaveBeenCalledWith(operationLog);

    const insertPayload = txMocks.values.mock.calls[0][0];
    expect(insertPayload).toMatchObject({
      animeId: 'anime-1',
      operation: 'update',
      status: 'pending',
      createdAt: now,
    });
    expect(JSON.parse(insertPayload.payload)).toEqual({
      episodesWatched: 4,
      lastWatchedAt: now,
    });
  });

  it.each([
    ['capPlus', (mutate: ReturnType<typeof useMutateAnime>) => mutate.capPlus('anime-1')],
    ['capMinus', (mutate: ReturnType<typeof useMutateAnime>) => mutate.capMinus('anime-1')],
    ['setEstado', (mutate: ReturnType<typeof useMutateAnime>) => mutate.setEstado('anime-1', 2)],
  ])('%s pide un flush en background después de mutar', async (_name, mutate) => {
    const { requestFlush: mockRequestFlush } = jest.requireMock(
      '../../../src/features/sync/sync-flush.helpers'
    ) as { requestFlush: jest.Mock };
    mockRequestFlush.mockResolvedValue(1);
    const txMocks = createTxDbMocks();
    mockCreateDrizzleDb.mockReturnValue(buildSelectMock(baseAnimeRow));
    mockAnimeDeferredWrite(txMocks.txDb);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await mutate(result.current);
      await Promise.resolve();
    });

    expect(mockRequestFlush).toHaveBeenCalledWith(rawDb, 'local_mutation');
  });

  it('propaga el error si falla el insert del operation_log', async () => {
    const insertError = new Error('operation log insert failed');
    const selectMock = buildSelectMock(baseAnimeRow);
    const txMocks = createTxDbMocks({ insertError });

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);

    const { result } = renderHook(() => useMutateAnime());

    await expect(result.current.capPlus('anime-1')).rejects.toThrow(insertError);
    expect(txMocks.update).toHaveBeenCalledWith(animes);
    expect(txMocks.insert).toHaveBeenCalledWith(operationLog);
  });

  it('persists the write failure as local_mutation_write', async () => {
    const insertError = new Error('database is locked');
    const selectMock = buildSelectMock(baseAnimeRow);
    const txMocks = createTxDbMocks({ insertError });

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);

    const { result } = renderHook(() => useMutateAnime());

    await expect(result.current.capPlus('anime-1')).rejects.toThrow(insertError);

    expect(mockRecordSyncAttemptFailed).toHaveBeenCalledWith(
      rawDb,
      'local_mutation_write',
      now,
      'capPlus: database is locked'
    );
  });

  // Guards the `await` in runTrackedMutation's catch. Two weaker forms of this test do NOT work:
  // asserting the mock was called (it is invoked synchronously either way), and comparing
  // completion order against an async mock (jest's `rejects` drains enough microtasks to hide
  // the difference). Both still pass with the `await` deleted. Only gating the telemetry promise
  // on a manual resolver discriminates: while it is unresolved, an awaited call cannot settle.
  it('waits for the telemetry write to settle before rethrowing', async () => {
    const insertError = new Error('database is locked');
    const selectMock = buildSelectMock(baseAnimeRow);
    const txMocks = createTxDbMocks({ insertError });

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);

    let releaseTelemetry!: () => void;
    mockRecordSyncAttemptFailed.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseTelemetry = resolve;
        }),
    );

    const { result } = renderHook(() => useMutateAnime());

    const pendingMutation = result.current.capPlus('anime-1');
    let hasSettled = false;
    pendingMutation.catch(() => {
      hasSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hasSettled).toBe(false);

    releaseTelemetry();
    await expect(pendingMutation).rejects.toThrow(insertError);
  });

  it('never masks the original failure when telemetry also fails', async () => {
    const insertError = new Error('database is locked');
    const selectMock = buildSelectMock(baseAnimeRow);
    const txMocks = createTxDbMocks({ insertError });

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);
    mockRecordSyncAttemptFailed.mockRejectedValueOnce(new Error('telemetry write failed'));

    const { result } = renderHook(() => useMutateAnime());

    await expect(result.current.capMinus('anime-1')).rejects.toThrow(insertError);
  });

  it('records no failure telemetry when the mutation succeeds', async () => {
    const selectMock = buildSelectMock(baseAnimeRow);
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1');
    });

    expect(mockRecordSyncAttemptFailed).not.toHaveBeenCalled();
  });

  it('capPlus agrega fechaEstreno cuando primeravez es 1', async () => {
    const selectMock = buildSelectMock({ ...baseAnimeRow, primeravez: 1 });
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1');
    });

    expect(txMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 4,
      fechaUltCapVisto: now,
      fechaEstreno: now,
      primeravez: 0,
    });
  });

  it('capPlus autofinaliza en un solo patch absoluto cuando nrocapvisto + 1 == totalcap', async () => {
    const selectMock = buildSelectMock({ ...baseAnimeRow, nrocapvisto: 11, totalcap: 12 });
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1');
    });

    expect(txMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 12,
      fechaUltCapVisto: now,
      estado: 1,
    });

    expect(txMocks.values).toHaveBeenCalledTimes(1);
    expect(txMocks.values).toHaveBeenNthCalledWith(1, {
      animeId: 'anime-1',
      operation: 'update',
      payload: JSON.stringify({
        episodesWatched: 12,
        lastWatchedAt: now,
        status: 1,
      }),
      status: 'pending',
      createdAt: now,
    });
  });

  it('capMinus nunca baja nrocapvisto de cero', async () => {
    const selectMock = buildSelectMock({ ...baseAnimeRow, nrocapvisto: 0 });
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capMinus('anime-1');
    });

    expect(txMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 0,
      fechaUltCapVisto: now,
    });
  });

  it('capMinus actualiza fechaUltCapVisto y registra cap_minus', async () => {
    const selectMock = buildSelectMock(baseAnimeRow);
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capMinus('anime-1');
    });

    expect(txMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 2,
      fechaUltCapVisto: now,
    });

    const insertPayload = txMocks.values.mock.calls[0][0];
    expect(insertPayload.operation).toBe('update');
    expect(insertPayload.status).toBe('pending');
    expect(JSON.parse(insertPayload.payload)).toEqual({
      episodesWatched: 2,
      lastWatchedAt: now,
    });
  });

  it('setEstado escribe el patch de estado y registra operation_log pendiente', async () => {
    const selectMock = buildSelectMock(baseAnimeRow);
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.setEstado('anime-1', 3);
    });

    expect(txMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 3,
      fechaUltCapVisto: now,
      estado: 3,
    });

    const insertPayload = txMocks.values.mock.calls[0][0];
    expect(JSON.parse(insertPayload.payload)).toEqual({
      episodesWatched: 3,
      lastWatchedAt: now,
      status: 3,
    });
  });

  it('setEstado snapea nrocapvisto a totalcap cuando se marca finalizado', async () => {
    const selectMock = buildSelectMock({ ...baseAnimeRow, nrocapvisto: 5, totalcap: 12 });
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.setEstado('anime-1', 1);
    });

    expect(txMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 12,
      fechaUltCapVisto: now,
      estado: 1,
    });
  });

  it('capPlusHalf escribe nrocapvisto fraccionario en el patch', async () => {
    const selectMock = buildSelectMock(baseAnimeRow);
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlusHalf('anime-1');
    });

    expect(txMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 3.5,
      fechaUltCapVisto: now,
    });
  });

  it('capMinusHalf nunca baja nrocapvisto de cero', async () => {
    const selectMock = buildSelectMock({ ...baseAnimeRow, nrocapvisto: 0 });
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockAnimeDeferredWrite(txMocks.txDb);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capMinusHalf('anime-1');
    });

    expect(txMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 0,
      fechaUltCapVisto: now,
    });
  });

  it('delega toda la lógica de mutación al helper sin tocar client/schema directamente', () => {
    const sourcePath = path.resolve(
      __dirname,
      '../../../src/features/animes/use-mutate-anime.ts'
    );
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toMatch(/from ['"]\.\/anime-mutation\.helpers['"]/);
    expect(source).not.toMatch(/from ['"]\.\.\/\.\.\/db\/schema['"]/);
    expect(source).not.toContain('runMigrations');
    expect(source).not.toContain('.transaction(');
  });
});
