import { LocalWriteError } from '../../../src/infrastructure/db/client/client.errors';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  applyAnimeMutationPatch,
  buildCapMinusPatch,
  buildCapPlusHalfPatch,
  buildCapPlusPatch,
  buildSetEstadoPatch,
} from '../../../src/features/animes/anime-mutation.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

// The ONLY production module mocked here, and only to hand drizzle a node:sqlite handle
// instead of expo-sqlite. The mutation helpers, the write door and the transaction all run
// for real, so these assertions are about persisted state, never about call order.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** The `animes` columns these flows move. */
interface StoredAnimeRow {
  _id: string;
  nrocapvisto: number;
  estado: number;
}

/** One queued outbox row produced by a local mutation. */
interface StoredOperationRow {
  anime_id: string;
  operation: string;
  payload: string;
  status: string;
}

/** Opens a migrated database holding one anime at four watched chapters, unpaired. */
async function openWithAnime(nrocapvisto = 4, estado = 0): Promise<SQLiteDatabase> {
  const adapter = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  await adapter.runAsync(
    'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez) VALUES (?, ?, ?, ?, ?, ?)',
    'anime-1',
    'Test Anime',
    estado,
    nrocapvisto,
    1,
    1,
  );

  return adapter;
}

/** Reads back the single anime row under test. */
async function readAnime(adapter: SQLiteDatabase): Promise<StoredAnimeRow | null> {
  return adapter.getFirstAsync<StoredAnimeRow>(
    'SELECT _id, nrocapvisto, estado FROM animes WHERE _id = ?',
    'anime-1',
  );
}

/** Reads back every queued outbox row. */
async function readOutbox(adapter: SQLiteDatabase): Promise<StoredOperationRow[]> {
  return adapter.getAllAsync<StoredOperationRow>(
    'SELECT anime_id, operation, payload, status FROM operation_log ORDER BY id ASC',
  );
}

/** One instrumented connection: the SQLite handle a case drives, plus what the poison saw. */
interface InstrumentedConnection {
  readonly getFirstAsync: jest.Mock;
  readonly runAsync: jest.Mock;
  readonly violations: string[];
}

/**
 * Instruments a migrated adapter in place so the two statements the action path must use are
 * observable, and every SYNCHRONOUS statement entry point records a violation and throws.
 *
 * The adapter object itself is kept (not wrapped) on purpose: `withLocalWrite` builds an unused
 * drizzle handle for its callback's first argument, and the test proxy resolves that handle by
 * adapter identity. Keeping identity means this case measures the statements the action path
 * picks, not whether the shared write door can be handed a foreign object.
 */
function instrumentConnection(adapter: SQLiteDatabase): InstrumentedConnection {
  const violations: string[] = [];
  const target = adapter as unknown as Record<string, unknown>;
  const poison = (member: string) => () => {
    violations.push(member);
    throw new Error(`synchronous SQLite access on the mutation path: ${member}`);
  };

  target.execSync = poison('execSync');
  target.runSync = poison('runSync');
  target.getAllSync = poison('getAllSync');
  target.prepareSync = poison('prepareSync');

  const getFirstAsync = jest.fn(adapter.getFirstAsync.bind(adapter));
  const runAsync = jest.fn(adapter.runAsync.bind(adapter));
  target.getFirstAsync = getFirstAsync;
  target.runAsync = runAsync;

  return { getFirstAsync, runAsync, violations };
}

describe('a local chapter mutation updates the row and queues exactly one outbox operation', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
  });

  it('advances the watched chapter count and queues the operation in the same transaction', async () => {
    const adapter = await openWithAnime(4);

    await applyAnimeMutationPatch(adapter, 'anime-1', buildCapPlusPatch, 'cap+');

    const anime = await readAnime(adapter);
    const outbox = await readOutbox(adapter);

    expect(anime?.nrocapvisto).toBe(5);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ anime_id: 'anime-1', status: 'pending' });
    // The queued payload carries the new value, so a later reconcile sends the user's real edit.
    expect(JSON.parse(outbox[0].payload)).toMatchObject({ episodesWatched: 5 });
  });

  it('supports half-chapter progress without losing precision', async () => {
    const adapter = await openWithAnime(4);

    await applyAnimeMutationPatch(adapter, 'anime-1', buildCapPlusHalfPatch, 'cap+0.5');

    expect((await readAnime(adapter))?.nrocapvisto).toBe(4.5);
  });

  it('decrements the watched chapter count', async () => {
    const adapter = await openWithAnime(4);

    await applyAnimeMutationPatch(adapter, 'anime-1', buildCapMinusPatch, 'cap-');

    expect((await readAnime(adapter))?.nrocapvisto).toBe(3);
  });

  it.each([0, 1, 2, 3])('changes only estado to %s and queues only status', async (estado) => {
    const adapter = await openWithAnime(1, (estado + 1) % 4);
    await adapter.runAsync(
      'UPDATE animes SET totalcap = 12, fechaUltCapVisto = 1700000000000 WHERE _id = ?',
      'anime-1',
    );
    const before = await adapter.getFirstAsync<Record<string, unknown>>(
      'SELECT * FROM animes WHERE _id = ?',
      'anime-1',
    );
    // Without the seeded row the whole-row assertion below would compare against nothing.
    if (!before) throw new Error('expected the seeded anime row to exist');

    const changed = await applyAnimeMutationPatch(
      adapter,
      'anime-1',
      () => buildSetEstadoPatch(estado),
      'estado',
    );

    expect(changed).toBe(true);
    expect(await adapter.getFirstAsync('SELECT * FROM animes WHERE _id = ?', 'anime-1'))
      .toEqual({ ...before, estado });
    const outbox = await readOutbox(adapter);
    expect(outbox).toEqual([{
      anime_id: 'anime-1',
      operation: 'update',
      payload: JSON.stringify({ status: estado }),
      status: 'pending',
    }]);
  });

  it('writes nothing at all when the anime does not exist', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);

    await applyAnimeMutationPatch(adapter, 'anime-missing', buildCapPlusPatch, 'cap+');

    // No row to mutate means no phantom outbox entry -- otherwise the bridge would receive an
    // operation for a record the device never had.
    expect(await readOutbox(adapter)).toEqual([]);
  });

  it('queues one operation per mutation, so repeated taps are all delivered', async () => {
    const adapter = await openWithAnime(4);

    await applyAnimeMutationPatch(adapter, 'anime-1', buildCapPlusPatch, 'cap+');
    await applyAnimeMutationPatch(adapter, 'anime-1', buildCapPlusPatch, 'cap+');

    const anime = await readAnime(adapter);
    const outbox = await readOutbox(adapter);

    expect(anime?.nrocapvisto).toBe(6);
    expect(outbox).toHaveLength(2);
  });

  it('commits a valid increment through the connection async API, never its synchronous one', async () => {
    const adapter = await openWithAnime(4);
    // A FULL row, not the three columns the assertion reads: the read has to hand
    // `parseStoredAnimeRow` the same shape the drizzle select did, and the write has to leave
    // every column outside the patch byte-identical.
    await adapter.runAsync(
      `UPDATE animes SET totalcap = 12, primeravez = 0, dias = '[]', generos = '["Accion"]',
         episodes = '[{"episode":1,"minutes":24,"long":false}]',
         season = '{"seasonId":"season-1","grade":null}', carpeta = 'Carpeta',
         folder_relative = 'Carpeta/Sub', bridge_modified_at = 1700000000123,
         last_applied_change_ms = 1700000000456
       WHERE _id = ?`,
      'anime-1',
    );
    const before = await adapter.getFirstAsync<Record<string, unknown>>(
      'SELECT * FROM animes WHERE _id = ?',
      'anime-1',
    );
    if (!before) throw new Error('expected the seeded anime row to exist');

    const { getFirstAsync, runAsync, violations } = instrumentConnection(adapter);

    await expect(
      applyAnimeMutationPatch(adapter, 'anime-1', buildCapPlusPatch, 'cap+'),
    ).resolves.toBe(true);

    // The read and both writes went through the connection's asynchronous API, which expo's
    // Android binding runs on `Dispatchers.IO`; no synchronous entry point was touched.
    expect(violations).toEqual([]);
    expect(getFirstAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^SELECT .* FROM animes WHERE _id = \? LIMIT 1$/),
      'anime-1',
    );
    expect(runAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^UPDATE animes SET /),
      expect.any(Number),
      expect.any(Number),
      'anime-1',
    );
    expect(runAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^INSERT INTO operation_log /),
      'anime-1',
      'update',
      expect.any(String),
      'pending',
      expect.any(Number),
    );
    expect(await adapter.getFirstAsync('SELECT * FROM animes WHERE _id = ?', 'anime-1')).toEqual({
      ...before,
      nrocapvisto: 5,
      fechaUltCapVisto: expect.any(Number),
    });
    const outbox = await readOutbox(adapter);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ anime_id: 'anime-1', operation: 'update', status: 'pending' });
    expect(JSON.parse(outbox[0].payload)).toEqual({
      episodesWatched: 5,
      lastWatchedAt: expect.any(Number),
    });
  });

  it('rolls back the row and the queued operation when storage rejects the outbox write', async () => {
    const adapter = await openWithAnime(4);
    await adapter.execAsync(
      "CREATE TRIGGER reject_operation_log BEFORE INSERT ON operation_log " +
        "BEGIN SELECT RAISE(ABORT, 'outbox write refused'); END",
    );
    const before = await adapter.getFirstAsync<Record<string, unknown>>(
      'SELECT * FROM animes WHERE _id = ?',
      'anime-1',
    );

    // The write door reports the rejected transaction, and the statement that failed is the outbox
    // insert -- reached only after the UPDATE. The vendor text is not asserted: it belongs to
    // whichever driver issued the statement, not to this behaviour.
    await expect(
      applyAnimeMutationPatch(adapter, 'anime-1', buildCapPlusPatch, 'cap+'),
    ).rejects.toThrow(LocalWriteError);

    // The UPDATE ran before the rejected insert, so only the transaction's rollback can undo it.
    expect(await adapter.getFirstAsync('SELECT * FROM animes WHERE _id = ?', 'anime-1')).toEqual(
      before,
    );
    expect(await readOutbox(adapter)).toEqual([]);

    await adapter.execAsync('DROP TRIGGER reject_operation_log');

    // A rejected action must not poison the ones after it.
    await expect(
      applyAnimeMutationPatch(adapter, 'anime-1', buildCapPlusPatch, 'cap+'),
    ).resolves.toBe(true);
    expect((await readAnime(adapter))?.nrocapvisto).toBe(5);
  });
});
