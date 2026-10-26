import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, renderHook } from '@testing-library/react-native';
import {
  observeAnimeMutationDurability,
  resetAnimeMutationProjection,
} from '../../../src/features/animes/anime-mutation-projection.helpers';
import { useMutateAnime } from '../../../src/features/animes/use-mutate-anime';
import {
  animeUpdates,
  buildAnimeRow,
  buildDurableAnime,
  createTransactionConnection,
  mockAnimeDeferredWrite,
  mockQueuedDeferredWrite,
  operationInserts,
  shownChapters,
} from './use-mutate-anime-test.helpers';

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

/** Fixed clock reading every expected timestamp is computed against. */
const now = 1710000000000;
/** A dummy raw DB handle: every dependency that would read it is mocked above. */
const rawDb = { name: 'raw-db' };

describe('useMutateAnime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAnimeMutationProjection();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    mockUseSQLiteContext.mockReturnValue(rawDb);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('acepta nueve +1 rápidos sin esperar la escritura y los persiste en orden', async () => {
    const durableRow = buildAnimeRow({ nrocapvisto: 1, totalcap: 12 });
    const connection = createTransactionConnection({ row: durableRow });
    const { releaseFirstWrite } = mockQueuedDeferredWrite(mockWithDeferredWrite, connection);
    const durableAnime = buildDurableAnime(durableRow);
    observeAnimeMutationDurability([durableAnime]);

    const { result } = renderHook(() => useMutateAnime());

    const presses = Array.from({ length: 9 }, () => result.current.capPlus('anime-1'));

    // The first write has not even started, and the list already draws chapter 10: no tap waits
    // for the one before it, and none of the nine is disabled or dropped.
    expect(connection.getFirstAsync).not.toHaveBeenCalled();
    expect(shownChapters(durableAnime)).toBe(10);

    await act(async () => {
      releaseFirstWrite();
      await Promise.all(presses);
    });

    // One ordered write per tap, each reading what the previous one committed: nine absolute
    // patches 2..10, never one coalesced patch and never nine copies of the same value.
    expect(connection.getFirstAsync).toHaveBeenCalledTimes(9);
    expect(animeUpdates(connection).map((update) => update.nrocapvisto)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(operationInserts(connection)).toHaveLength(9);
    expect(JSON.parse(operationInserts(connection)[8]?.payload as string)).toEqual({
      episodesWatched: 10,
      lastWatchedAt: now,
    });
  });

  it('capPlus lee el estado actual de SQLite, actualiza el anime y crea operation_log pendiente', async () => {
    const connection = createTransactionConnection();

    mockAnimeDeferredWrite(mockWithDeferredWrite, connection);

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
    mockAnimeDeferredWrite(mockWithDeferredWrite, createTransactionConnection());

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
    const { releaseFirstWrite } = mockQueuedDeferredWrite(mockWithDeferredWrite, connection);
    const durableAnime = buildDurableAnime(buildAnimeRow());
    observeAnimeMutationDurability([durableAnime]);

    const { result } = renderHook(() => useMutateAnime());

    const press = result.current.capPlus('anime-1');
    expect(shownChapters(durableAnime)).toBe(4);

    await act(async () => {
      releaseFirstWrite();
      await expect(press).rejects.toThrow(insertError);
    });

    // The rejected write takes its optimistic chapter with it: the card shows what the row still
    // holds, not a value the rolled-back transaction never stored.
    expect(shownChapters(durableAnime)).toBe(3);

    // The row update was issued first, and the rejected insert is the one that failed: the order
    // the transaction hands back is what decides whether a rollback has an update to undo.
    expect(animeUpdates(connection)).toHaveLength(1);
    expect(operationInserts(connection)).toHaveLength(1);
  });

  it('records the write failure as a failed attempt', async () => {
    const insertError = new Error('database is locked');
    const connection = createTransactionConnection({ insertError });

    mockAnimeDeferredWrite(mockWithDeferredWrite, connection);

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

    mockAnimeDeferredWrite(mockWithDeferredWrite, connection);

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

    mockAnimeDeferredWrite(mockWithDeferredWrite, connection);
    mockRecordSyncAttemptFailed.mockRejectedValueOnce(new Error('telemetry write failed'));

    const { result } = renderHook(() => useMutateAnime());

    await expect(result.current.capMinus('anime-1')).rejects.toThrow(insertError);
  });

  it('records no failure telemetry when the mutation succeeds', async () => {
    mockAnimeDeferredWrite(mockWithDeferredWrite, createTransactionConnection());

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlus('anime-1');
    });

    expect(mockRecordSyncAttemptFailed).not.toHaveBeenCalled();
  });

  it('capPlus agrega fechaEstreno cuando primeravez es 1', async () => {
    const connection = createTransactionConnection({ row: buildAnimeRow({ primeravez: 1 }) });

    mockAnimeDeferredWrite(mockWithDeferredWrite, connection);

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
      row: buildAnimeRow({ nrocapvisto: 11, totalcap: 12 }),
    });

    mockAnimeDeferredWrite(mockWithDeferredWrite, connection);

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
    const connection = createTransactionConnection({ row: buildAnimeRow({ nrocapvisto: 0 }) });

    mockAnimeDeferredWrite(mockWithDeferredWrite, connection);

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

    mockAnimeDeferredWrite(mockWithDeferredWrite, connection);

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
      row: buildAnimeRow({
        estado: (estado + 1) % 4,
        nrocapvisto: 1,
        totalcap: 12,
        primeravez: 1,
        fechaUltCapVisto: now - 86400000,
      }),
    });

    mockAnimeDeferredWrite(mockWithDeferredWrite, connection);

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

    mockAnimeDeferredWrite(mockWithDeferredWrite, connection);

    const { result } = renderHook(() => useMutateAnime());

    await act(async () => {
      await result.current.capPlusHalf('anime-1');
    });

    expect(animeUpdates(connection)).toEqual([
      { nrocapvisto: 3.5, fechaUltCapVisto: now, _id: 'anime-1' },
    ]);
  });

  it('capMinusHalf nunca baja nrocapvisto de cero', async () => {
    const connection = createTransactionConnection({ row: buildAnimeRow({ nrocapvisto: 0 }) });

    mockAnimeDeferredWrite(mockWithDeferredWrite, connection);

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
