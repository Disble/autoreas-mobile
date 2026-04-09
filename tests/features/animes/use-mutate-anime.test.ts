import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, renderHook } from '@testing-library/react-native';
import { animes, operationLog } from '../../../src/infrastructure/db/schema';
import { useMutateAnime } from '../../../src/features/animes/use-mutate-anime';

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  createDrizzleDb: jest.fn(),
  withExclusiveWrite: jest.fn(),
}));

jest.mock('../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn().mockResolvedValue(0),
}));

const { useSQLiteContext: mockUseSQLiteContext } = jest.requireMock('expo-sqlite') as {
  useSQLiteContext: jest.Mock;
};

const { createDrizzleDb: mockCreateDrizzleDb, withExclusiveWrite: mockWithExclusiveWrite } =
  jest.requireMock('../../../src/infrastructure/db/client') as {
    createDrizzleDb: jest.Mock;
    withExclusiveWrite: jest.Mock;
  };

type MockTxDb = {
  update: jest.Mock;
  insert: jest.Mock;
};

const now = 1710000000000;
const rawDb = { name: 'raw-db' };

// Base anime as it comes from SQLite (dias/generos as strings, activo/primeravez as integers)
// Typed as Record to allow overrides like { totalcap: 12 } without TS narrowing null literals
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

/**
 * Builds the Drizzle query-builder mock that returns a single row on `.limit(1)`.
 * Used to simulate the SELECT before mutating.
 */
function buildSelectMock(row: Record<string, unknown> | null) {
  const limit = jest.fn().mockResolvedValue(row ? [row] : []);
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  return { select, from, where, limit };
}

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
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(txMocks.txDb));

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1');
    });

    // Must SELECT current state using the transactional db acquired by withExclusiveWrite
    expect(mockCreateDrizzleDb).toHaveBeenCalledWith(undefined);
    expect(selectMock.select).toHaveBeenCalled();

    expect(mockWithExclusiveWrite).toHaveBeenCalledWith(rawDb, expect.any(Function));
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
      nrocapvisto: 4,
      fechaUltCapVisto: now,
    });
  });

  it('capPlus dispara syncPendingOperations en background después de mutar', async () => {
    const { syncPendingOperations: mockSync } = jest.requireMock(
      '../../../src/features/sync/reconcile.helpers'
    ) as { syncPendingOperations: jest.Mock };
    mockSync.mockResolvedValue(1);

    const selectMock = buildSelectMock(baseAnimeRow);
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(txMocks.txDb));

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1');
      // flush microtasks so the fire-and-forget promise settles
      await Promise.resolve();
    });

    expect(mockSync).toHaveBeenCalledWith(rawDb);
  });

  it('propaga el error si falla el insert del operation_log', async () => {
    const insertError = new Error('operation log insert failed');
    const selectMock = buildSelectMock(baseAnimeRow);
    const txMocks = createTxDbMocks({ insertError });

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(txMocks.txDb));

    const { result } = renderHook(() => useMutateAnime());

    await expect(result.current.capPlus('anime-1')).rejects.toThrow(insertError);
    expect(txMocks.update).toHaveBeenCalledWith(animes);
    expect(txMocks.insert).toHaveBeenCalledWith(operationLog);
  });

  it('capPlus agrega fechaEstreno cuando primeravez es 1', async () => {
    const selectMock = buildSelectMock({ ...baseAnimeRow, primeravez: 1 });
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(txMocks.txDb));

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
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(txMocks.txDb));

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
        nrocapvisto: 12,
        fechaUltCapVisto: now,
        estado: 1,
      }),
      status: 'pending',
      createdAt: now,
    });
  });

  it('capMinus nunca baja nrocapvisto de cero', async () => {
    const selectMock = buildSelectMock({ ...baseAnimeRow, nrocapvisto: 0 });
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(txMocks.txDb));

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
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(txMocks.txDb));

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
      nrocapvisto: 2,
      fechaUltCapVisto: now,
    });
  });

  it('capMinus dispara syncPendingOperations en background después de mutar', async () => {
    const { syncPendingOperations: mockSync } = jest.requireMock(
      '../../../src/features/sync/reconcile.helpers'
    ) as { syncPendingOperations: jest.Mock };
    mockSync.mockResolvedValue(1);

    const selectMock = buildSelectMock(baseAnimeRow);
    const txMocks = createTxDbMocks();

    mockCreateDrizzleDb.mockReturnValue(selectMock);
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(txMocks.txDb));

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capMinus('anime-1');
      await Promise.resolve();
    });

    expect(mockSync).toHaveBeenCalledWith(rawDb);
  });

  it('reusa client y schema sin imports incorrectos ni migraciones en el hook', () => {
    const sourcePath = path.resolve(
      __dirname,
      '../../../src/features/animes/use-mutate-anime.ts'
    );
    const source = readFileSync(sourcePath, 'utf8');

    // Path checks are quote-style agnostic (lefthook may reformat to double quotes)
    expect(source).toMatch(/from ['"]\.\.\/\.\.\/infrastructure\/db\/client['"]/);
    expect(source).toMatch(/from ['"]\.\.\/\.\.\/infrastructure\/db\/schema['"]/);
    expect(source).not.toMatch(/from ['"]\.\.\/\.\.\/db\/schema['"]/);
    expect(source).not.toContain('runMigrations');
    expect(source).not.toContain('.transaction(');
  });
});
