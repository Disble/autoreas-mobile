import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, renderHook } from '@testing-library/react-native';
import { animes, operationLog } from '../../../src/infrastructure/db/schema';
import type { Anime } from '../../../src/infrastructure/validation/anime-schema';

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  withExclusiveWrite: jest.fn(),
}));

const { useSQLiteContext: mockUseSQLiteContext } = jest.requireMock('expo-sqlite') as {
  useSQLiteContext: jest.Mock;
};

const { withExclusiveWrite: mockWithExclusiveWrite } = jest.requireMock(
  '../../../src/infrastructure/db/client'
) as {
  withExclusiveWrite: jest.Mock;
};

import { useMutateAnime } from '../../../src/features/animes/use-mutate-anime';

type MockDb = {
  update: jest.Mock;
  insert: jest.Mock;
};

function createDbMocks(options?: { insertError?: Error }) {
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));
  const values = options?.insertError
    ? jest.fn().mockRejectedValue(options.insertError)
    : jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn(() => ({ values }));

  return {
    db: { update, insert } satisfies MockDb,
    where,
    set,
    update,
    values,
    insert,
  };
}

const now = 1710000000000;
const rawDb = { name: 'raw-db' };
const baseAnime: Anime = {
  _id: 'anime-1',
  nombre: 'One Piece',
  estado: 0,
  nrocapvisto: 3,
  activo: 1,
  primeravez: 0,
  generos: [],
  dias: [],
};

describe('useMutateAnime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    mockUseSQLiteContext.mockReturnValue(rawDb);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('capPlus actualiza el anime y crea operation_log pendiente', async () => {
    const dbMocks = createDbMocks();
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(dbMocks.db));

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus(baseAnime);
    });

    expect(mockWithExclusiveWrite).toHaveBeenCalledWith(rawDb, expect.any(Function));
    expect(dbMocks.update).toHaveBeenCalledWith(animes);
    expect(dbMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 4,
      fechaUltCapVisto: now,
    });
    expect(dbMocks.insert).toHaveBeenCalledWith(operationLog);

    const insertPayload = dbMocks.values.mock.calls[0][0];
    expect(insertPayload).toMatchObject({
      animeId: 'anime-1',
      operation: 'cap_plus',
      status: 'pending',
      createdAt: now,
    });
    expect(JSON.parse(insertPayload.payload)).toEqual({ nrocapvisto: 4 });
  });

  it('propaga el error si falla el insert del operation_log', async () => {
    const insertError = new Error('operation log insert failed');
    const dbMocks = createDbMocks({ insertError });
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(dbMocks.db));

    const { result } = renderHook(() => useMutateAnime());

    await expect(result.current.capPlus(baseAnime)).rejects.toThrow(insertError);
    expect(dbMocks.update).toHaveBeenCalledWith(animes);
    expect(dbMocks.insert).toHaveBeenCalledWith(operationLog);
  });

  it('capPlus agrega fechaEstreno cuando primeravez es 1', async () => {
    const dbMocks = createDbMocks();
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(dbMocks.db));

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus({ ...baseAnime, primeravez: 1 });
    });

    expect(dbMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 4,
      fechaUltCapVisto: now,
      fechaEstreno: now,
      primeravez: 0,
    });
  });

  it('capPlus autofinaliza y registra estado_change cuando nrocapvisto + 1 == totalcap', async () => {
    const dbMocks = createDbMocks();
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(dbMocks.db));

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus({ ...baseAnime, nrocapvisto: 11, totalcap: 12 });
    });

    expect(dbMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 12,
      fechaUltCapVisto: now,
      estado: 1,
    });

    expect(dbMocks.values).toHaveBeenCalledTimes(2);
    expect(dbMocks.values).toHaveBeenNthCalledWith(1, {
      animeId: 'anime-1',
      operation: 'cap_plus',
      payload: JSON.stringify({ nrocapvisto: 12 }),
      status: 'pending',
      createdAt: now,
    });
    expect(dbMocks.values).toHaveBeenNthCalledWith(2, {
      animeId: 'anime-1',
      operation: 'estado_change',
      payload: JSON.stringify({ estado: 1 }),
      status: 'pending',
      createdAt: now,
    });
  });

  it('capMinus nunca baja nrocapvisto de cero', async () => {
    const dbMocks = createDbMocks();
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(dbMocks.db));

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capMinus({ ...baseAnime, nrocapvisto: 0 });
    });

    expect(dbMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 0,
      fechaUltCapVisto: now,
    });
  });

  it('capMinus actualiza fechaUltCapVisto y registra cap_minus', async () => {
    const dbMocks = createDbMocks();
    mockWithExclusiveWrite.mockImplementation(async (_db, task) => task(dbMocks.db));

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capMinus(baseAnime);
    });

    expect(dbMocks.set).toHaveBeenCalledWith({
      nrocapvisto: 2,
      fechaUltCapVisto: now,
    });

    const insertPayload = dbMocks.values.mock.calls[0][0];
    expect(insertPayload.operation).toBe('cap_minus');
    expect(insertPayload.status).toBe('pending');
    expect(JSON.parse(insertPayload.payload)).toEqual({ nrocapvisto: 2 });
  });

  it('reusa client y schema sin imports incorrectos ni migraciones en el hook', () => {
    const sourcePath = path.resolve(
      __dirname,
      '../../../src/features/animes/use-mutate-anime.ts'
    );
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toContain("from '../../infrastructure/db/client'");
    expect(source).toContain("from '../../infrastructure/db/schema'");
    expect(source).not.toContain("from '../../db/schema'");
    expect(source).not.toContain('runMigrations');
    expect(source).not.toContain('.transaction(');
  });
});
