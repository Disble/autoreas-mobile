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

  it('changes the estado and queues it for the bridge', async () => {
    const adapter = await openWithAnime(4, 0);

    await applyAnimeMutationPatch(
      adapter,
      'anime-1',
      (anime, now) => buildSetEstadoPatch(anime, 2, now),
      'estado',
    );

    const anime = await readAnime(adapter);
    const outbox = await readOutbox(adapter);

    expect(anime?.estado).toBe(2);
    expect(outbox).toHaveLength(1);
    expect(JSON.parse(outbox[0].payload)).toMatchObject({ status: 2 });
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
});
