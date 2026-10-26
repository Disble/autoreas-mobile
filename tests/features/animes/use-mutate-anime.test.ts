import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, renderHook } from '@testing-library/react-native';
import { useMutateAnime } from '../../../src/features/animes/use-mutate-anime';

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
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

/** Write-door fake: the `withLocalWrite` callback is driven directly. */
const { withLocalWrite: mockWithDeferredWrite } = jest.requireMock(
  '../../../src/infrastructure/db/client/client.helpers'
) as { withLocalWrite: jest.Mock };

/**
 * The transaction connection the mutation receives. The read resolves `row`, and every statement
 * the action path issues is recorded here as SQL plus its bound parameters -- which is what these
 * cases assert on, now that the statements are the connection's asynchronous API rather than a
 * drizzle builder chain.
 */
type FakeTransactionConnection = {
  readonly databasePath: string;
  readonly getFirstAsync: jest.Mock;
  readonly runAsync: jest.Mock;
};

/** Fixed clock reading every expected timestamp is computed against. */
const now = 1710000000000;
/** A dummy raw DB handle: every dependency that would read it is mocked above. */
const rawDb = { name: 'raw-db' };

/** One `animes` row fixture the mutation's read resolves with. */
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

/** Builds the fake connection, resolving `row` and optionally failing the outbox insert. */
function createTransactionConnection(options?: {
  readonly row?: Record<string, unknown>;
  readonly insertError?: Error;
}): FakeTransactionConnection {
  const insertError = options?.insertError;
  const runAsync = jest.fn().mockImplementation((sql: string) =>
    insertError && String(sql).startsWith('INSERT INTO operation_log')
      ? Promise.reject(insertError)
      : Promise.resolve({ lastInsertRowId: 1, changes: 1 }),
  );

  return {
    databasePath: 'test-db-transaction',
    getFirstAsync: jest.fn().mockResolvedValue(options?.row ?? baseAnimeRow),
    runAsync,
  };
}

/** Runs every `withLocalWrite` task against `connection`. */
function mockAnimeDeferredWrite(connection: FakeTransactionConnection) {
  mockWithDeferredWrite.mockImplementation(async (_db, task) =>
    task(connection as never, connection as never),
  );
}

/**
 * Reads the `UPDATE animes` statements back as column/value objects, one per call, plus the bound
 * `_id`. The expected values stay independent literals in every case; this only reverses the
 * parameterization so a case does not have to repeat the column order.
 */
function animeUpdates(connection: FakeTransactionConnection): readonly Record<string, unknown>[] {
  return connection.runAsync.mock.calls
    .filter(([sql]) => String(sql).startsWith('UPDATE animes SET '))
    .map(([sql, ...params]) => {
      const source = String(sql);
      const setList = source.slice(
        'UPDATE animes SET '.length,
        source.lastIndexOf(' WHERE '),
      );
      const columns = [...setList.matchAll(/(\w+) = \?/g)].map((match) => match[1]);
      const row = Object.fromEntries(
        columns.map((column, index) => [column, params[index] as unknown]),
      );

      return { ...row, _id: params[columns.length] };
    });
}

/** Reads the appended `operation_log` rows back as value objects, in write order. */
function operationInserts(
  connection: FakeTransactionConnection,
): readonly Record<string, unknown>[] {
  return connection.runAsync.mock.calls
    .filter(([sql]) => String(sql).startsWith('INSERT INTO operation_log '))
    .map(([, animeId, operation, payload, status, createdAt]) => ({
      animeId,
      operation,
      payload,
      status,
      createdAt,
    }));
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
    const connection = createTransactionConnection();

    mockAnimeDeferredWrite(connection);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1');
    });

    expect(connection.getFirstAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^SELECT .* FROM animes WHERE _id = \? LIMIT 1$/),
      'anime-1',
    );
    expect(mockWithDeferredWrite).toHaveBeenCalledWith(rawDb, expect.any(Function));
    expect(animeUpdates(connection)).toEqual([
      { nrocapvisto: 4, fechaUltCapVisto: now, _id: 'anime-1' },
    ]);

    const [insertPayload] = operationInserts(connection);
    expect(insertPayload).toMatchObject({
      animeId: 'anime-1',
      operation: 'update',
      status: 'pending',
      createdAt: now,
    });
    expect(JSON.parse(insertPayload.payload as string)).toEqual({
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
    mockAnimeDeferredWrite(createTransactionConnection());

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await mutate(result.current);
      await Promise.resolve();
    });

    expect(mockRequestFlush).toHaveBeenCalledWith(rawDb, 'local_mutation');
  });

  it('propaga el error si falla el insert del operation_log', async () => {
    const insertError = new Error('operation log insert failed');
    const connection = createTransactionConnection({ insertError });

    mockAnimeDeferredWrite(connection);

    const { result } = renderHook(() => useMutateAnime());

    await expect(result.current.capPlus('anime-1')).rejects.toThrow(insertError);
    // The row update was issued first, and the rejected insert is the one that failed: the order
    // the transaction hands back is what decides whether a rollback has an update to undo.
    expect(animeUpdates(connection)).toHaveLength(1);
    expect(operationInserts(connection)).toHaveLength(1);
  });

  it('records the write failure as a failed attempt', async () => {
    const insertError = new Error('database is locked');
    const connection = createTransactionConnection({ insertError });

    mockAnimeDeferredWrite(connection);

    const { result } = renderHook(() => useMutateAnime());

    await expect(result.current.capPlus('anime-1')).rejects.toThrow(insertError);

    expect(mockRecordSyncAttemptFailed).toHaveBeenCalledWith(rawDb, now);
  });

  // Guards the `await` in runTrackedMutation's catch. Two weaker forms of this test do NOT work:
  // asserting the mock was called (it is invoked synchronously either way), and comparing
  // completion order against an async mock (jest's `rejects` drains enough microtasks to hide
  // the difference). Both still pass with the `await` deleted. Only gating the telemetry promise
  // on a manual resolver discriminates: while it is unresolved, an awaited call cannot settle.
  it('waits for the telemetry write to settle before rethrowing', async () => {
    const insertError = new Error('database is locked');
    const connection = createTransactionConnection({ insertError });

    mockAnimeDeferredWrite(connection);

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
    const connection = createTransactionConnection({ insertError });

    mockAnimeDeferredWrite(connection);
    mockRecordSyncAttemptFailed.mockRejectedValueOnce(new Error('telemetry write failed'));

    const { result } = renderHook(() => useMutateAnime());

    await expect(result.current.capMinus('anime-1')).rejects.toThrow(insertError);
  });

  it('records no failure telemetry when the mutation succeeds', async () => {
    mockAnimeDeferredWrite(createTransactionConnection());

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1');
    });

    expect(mockRecordSyncAttemptFailed).not.toHaveBeenCalled();
  });

  it('capPlus agrega fechaEstreno cuando primeravez es 1', async () => {
    const connection = createTransactionConnection({ row: { ...baseAnimeRow, primeravez: 1 } });

    mockAnimeDeferredWrite(connection);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1');
    });

    expect(animeUpdates(connection)).toEqual([
      {
        nrocapvisto: 4,
        fechaUltCapVisto: now,
        fechaEstreno: now,
        primeravez: 0,
        _id: 'anime-1',
      },
    ]);
  });

  it('capPlus autofinaliza en un solo patch absoluto cuando nrocapvisto + 1 == totalcap', async () => {
    const connection = createTransactionConnection({
      row: { ...baseAnimeRow, nrocapvisto: 11, totalcap: 12 },
    });

    mockAnimeDeferredWrite(connection);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1');
    });

    expect(animeUpdates(connection)).toEqual([
      { nrocapvisto: 12, fechaUltCapVisto: now, estado: 1, _id: 'anime-1' },
    ]);
    expect(operationInserts(connection)).toEqual([
      {
        animeId: 'anime-1',
        operation: 'update',
        payload: JSON.stringify({
          episodesWatched: 12,
          lastWatchedAt: now,
          status: 1,
        }),
        status: 'pending',
        createdAt: now,
      },
    ]);
  });

  it('capMinus nunca baja nrocapvisto de cero', async () => {
    const connection = createTransactionConnection({ row: { ...baseAnimeRow, nrocapvisto: 0 } });

    mockAnimeDeferredWrite(connection);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capMinus('anime-1');
    });

    expect(animeUpdates(connection)).toEqual([
      { nrocapvisto: 0, fechaUltCapVisto: now, _id: 'anime-1' },
    ]);
  });

  it('capMinus actualiza fechaUltCapVisto y registra cap_minus', async () => {
    const connection = createTransactionConnection();

    mockAnimeDeferredWrite(connection);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capMinus('anime-1');
    });

    expect(animeUpdates(connection)).toEqual([
      { nrocapvisto: 2, fechaUltCapVisto: now, _id: 'anime-1' },
    ]);

    const [insertPayload] = operationInserts(connection);
    expect(insertPayload.operation).toBe('update');
    expect(insertPayload.status).toBe('pending');
    expect(JSON.parse(insertPayload.payload as string)).toEqual({
      episodesWatched: 2,
      lastWatchedAt: now,
    });
  });

  it.each([0, 1, 2, 3])('setEstado only writes and queues status %s', async (estado) => {
    const connection = createTransactionConnection({
      row: {
        ...baseAnimeRow,
        estado: (estado + 1) % 4,
        nrocapvisto: 1,
        totalcap: 12,
        primeravez: 1,
        fechaUltCapVisto: now - 86400000,
      },
    });

    mockAnimeDeferredWrite(connection);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.setEstado('anime-1', estado);
    });

    expect(animeUpdates(connection)).toEqual([{ estado, _id: 'anime-1' }]);
    expect(operationInserts(connection)).toEqual([
      {
        animeId: 'anime-1',
        operation: 'update',
        payload: JSON.stringify({ status: estado }),
        status: 'pending',
        createdAt: now,
      },
    ]);
  });

  it('capPlusHalf escribe nrocapvisto fraccionario en el patch', async () => {
    const connection = createTransactionConnection();

    mockAnimeDeferredWrite(connection);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlusHalf('anime-1');
    });

    expect(animeUpdates(connection)).toEqual([
      { nrocapvisto: 3.5, fechaUltCapVisto: now, _id: 'anime-1' },
    ]);
  });

  it('capMinusHalf nunca baja nrocapvisto de cero', async () => {
    const connection = createTransactionConnection({ row: { ...baseAnimeRow, nrocapvisto: 0 } });

    mockAnimeDeferredWrite(connection);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capMinusHalf('anime-1');
    });

    expect(animeUpdates(connection)).toEqual([
      { nrocapvisto: 0, fechaUltCapVisto: now, _id: 'anime-1' },
    ]);
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
