import { parseAnimeRow } from '../../../src/features/animes/anime.helpers';
import {
  applyAnimeMutationProjection,
  getAnimeMutationProjectionState,
} from '../../../src/features/animes/anime-mutation-projection.helpers';

/**
 * The transaction connection the mutation receives. The read resolves the fake row, and every
 * statement the action path issues is recorded here as SQL plus its bound parameters -- which is
 * what these cases assert on, now that the statements are the connection's asynchronous API rather
 * than a drizzle builder chain.
 */
export type FakeTransactionConnection = {
  readonly databasePath: string;
  readonly getFirstAsync: jest.Mock;
  readonly runAsync: jest.Mock;
};

/**
 * Builds one `animes` row fixture as the raw SQLite select would return it.
 * `overrides` exists so a case states only the column it cares about.
 */
export function buildAnimeRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

/** The parsed anime the read model would have observed for `row` before the first tap. */
export function buildDurableAnime(row: Record<string, unknown>) {
  return parseAnimeRow(row as unknown as Parameters<typeof parseAnimeRow>[0]);
}

/** The chapter count the list would draw right now: the durable row plus the intents on top of it. */
export function shownChapters(durable: ReturnType<typeof buildDurableAnime>) {
  return applyAnimeMutationProjection(durable, getAnimeMutationProjectionState()).nrocapvisto;
}

/** The column list of one `UPDATE animes SET ... WHERE _id = ?` statement, in statement order. */
function animeUpdateColumns(source: string): readonly string[] {
  const setList = source.slice(
    'UPDATE animes SET '.length,
    source.lastIndexOf(' WHERE '),
  );

  return [...setList.matchAll(/(\w+) = \?/g)].map((match) => match[1]);
}

/**
 * Builds the fake connection, resolving `row` and optionally failing the outbox insert.
 * The row it resolves is rewritten by every `UPDATE` it receives, so a queued write reads what the
 * previous one committed -- which is what makes ordered persistence observable here.
 */
export function createTransactionConnection(options?: {
  readonly row?: Record<string, unknown>;
  readonly insertError?: Error;
}): FakeTransactionConnection {
  const insertError = options?.insertError;
  let currentRow = { ...(options?.row ?? buildAnimeRow()) };

  const runAsync = jest.fn().mockImplementation(async (sql: string, ...params: unknown[]) => {
    const statement = String(sql);

    if (insertError && statement.startsWith('INSERT INTO operation_log')) {
      throw insertError;
    }

    if (statement.startsWith('UPDATE animes SET ')) {
      const nextRow = { ...currentRow };

      animeUpdateColumns(statement).forEach((column, index) => {
        nextRow[column] = params[index];
      });

      currentRow = nextRow;
    }

    return { lastInsertRowId: 1, changes: 1 };
  });

  return {
    databasePath: 'test-db-transaction',
    getFirstAsync: jest.fn().mockImplementation(async () => ({ ...currentRow })),
    runAsync,
  };
}

/** Runs every `withLocalWrite` task, in order, against `connection`. */
export function mockAnimeDeferredWrite(
  withLocalWrite: jest.Mock,
  connection: FakeTransactionConnection,
) {
  withLocalWrite.mockImplementation(async (_db, task) =>
    task(connection as never, connection as never),
  );
}

/**
 * Runs every `withLocalWrite` task one after another, holding the FIRST until the test releases it.
 * The hand-off is the write door's real ordering; the hold is the unresolved local write the
 * acceptance example is about, with nine more taps arriving while it is still in flight.
 */
export function mockQueuedDeferredWrite(
  withLocalWrite: jest.Mock,
  connection: FakeTransactionConnection,
) {
  let tail: Promise<unknown> = Promise.resolve();
  let releaseFirstWrite = () => {};
  let callCount = 0;

  const firstWriteGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });

  withLocalWrite.mockImplementation((_db, task) => {
    const callIndex = callCount;
    callCount += 1;

    const run = tail.then(async () => {
      if (callIndex === 0) {
        await firstWriteGate;
      }

      return task(connection as never, connection as never);
    });

    tail = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  });

  return { releaseFirstWrite: () => releaseFirstWrite() };
}

/**
 * Reads the `UPDATE animes` statements back as column/value objects, one per call, plus the bound
 * `_id`. The expected values stay independent literals in every case; this only reverses the
 * parameterization so a case does not have to repeat the column order.
 */
export function animeUpdates(
  connection: FakeTransactionConnection,
): readonly Record<string, unknown>[] {
  const updates: Record<string, unknown>[] = [];

  for (const [sql, ...params] of connection.runAsync.mock.calls) {
    if (!String(sql).startsWith('UPDATE animes SET ')) {
      continue;
    }

    const columns = animeUpdateColumns(String(sql));
    const row = Object.fromEntries(
      columns.map((column, index) => [column, params[index] as unknown]),
    );

    updates.push({ ...row, _id: params[columns.length] });
  }

  return updates;
}

/** Reads the appended `operation_log` rows back as value objects, in write order. */
export function operationInserts(
  connection: FakeTransactionConnection,
): readonly Record<string, unknown>[] {
  const inserts: Record<string, unknown>[] = [];

  for (const [sql, animeId, operation, payload, status, createdAt] of connection.runAsync.mock
    .calls) {
    if (!String(sql).startsWith('INSERT INTO operation_log ')) {
      continue;
    }

    inserts.push({ animeId, operation, payload, status, createdAt });
  }

  return inserts;
}
