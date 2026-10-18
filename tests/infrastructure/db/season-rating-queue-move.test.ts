import type { SQLiteDatabase } from 'expo-sqlite';
import { runMigrations } from '../../../src/infrastructure/db/client/client.helpers';
import { moveSeasonRatingQueueIntoOperationLog } from '../../../src/infrastructure/db/client/season-rating-queue-move.helpers';
import { prepareForegroundDatabase } from '../../../src/infrastructure/db/startup/startup.helpers';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

// Only the drizzle seam is swapped: the migrator is a no-op because `applyMigrationFiles` already
// ran the shipped SQL, and the repair steps under test run for real against real SQLite.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => async () => undefined,
  getOpenDatabaseSync: () => () => undefined,
}));

/** One `season_rating_queue` row as a device stamped 19 stored it. */
interface QueuedRating {
  readonly animeId: string;
  readonly nota: number;
  readonly status: string;
  readonly createdAt: number;
  readonly lastFailureKind: string | null;
}

/** Builds the schema an installed device carried before migration 0019 (readiness 19). */
async function openInstalledDevice(through = '0018'): Promise<SQLiteDatabase> {
  const adapter = createTestSqliteAdapter();
  await applyMigrationFiles(adapter, { through });
  await adapter.runAsync(
    "INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez) VALUES ('anime-1', 'Uno', 0, 4, 1, 1), ('anime-2', 'Dos', 1, 9, 1, 0)",
  );
  await adapter.runAsync(
    "INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES ('anime-1', 'update', '{\"episodesWatched\":5}', 'pending', 50), ('anime-2', 'update', '{\"estado\":1}', 'dead_letter', 60)",
  );

  return adapter;
}

/** Recreates the retired table at its migration-0009 shape, as a device that never ran the move holds it. */
async function recreateQueueTable(adapter: SQLiteDatabase): Promise<void> {
  await adapter.execAsync(
    "CREATE TABLE IF NOT EXISTS season_rating_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, season_id TEXT NOT NULL, anime_id TEXT NOT NULL, nota INTEGER NOT NULL, rated_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_attempt_at INTEGER, last_failure_kind TEXT)",
  );
}

/** Queues ratings in insertion order; their `created_at` order may differ from their id order. */
async function queueRatings(adapter: SQLiteDatabase, ratings: readonly QueuedRating[]): Promise<void> {
  for (const rating of ratings) {
    await adapter.runAsync(
      'INSERT INTO season_rating_queue (season_id, anime_id, nota, rated_at, status, created_at, updated_at, last_failure_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      'season-1',
      rating.animeId,
      rating.nota,
      rating.createdAt + 1,
      rating.status,
      rating.createdAt,
      rating.createdAt + 2,
      rating.lastFailureKind,
    );
  }
}

/** Reads every operation_log row with the columns the move writes. */
function readOperations(adapter: SQLiteDatabase) {
  return adapter.getAllAsync<Record<string, unknown>>(
    'SELECT id, anime_id, operation, payload, status, created_at, conflict_attempt_count, claim_owner, claimed_at, unresolved_reason FROM operation_log ORDER BY id',
  );
}

/** Whether the retired table still exists. */
async function hasQueueTable(adapter: SQLiteDatabase): Promise<boolean> {
  const row = await adapter.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE name = 'season_rating_queue'",
  );

  return row !== null;
}

/** A content hash of every table the move must not touch, plus the pre-existing anime rows. */
async function hashUntouched(adapter: SQLiteDatabase): Promise<string> {
  const tables = await adapter.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('season_rating_queue', 'operation_log', 'sqlite_sequence') ORDER BY name",
  );
  const contents: unknown[] = [];

  for (const { name } of tables) {
    contents.push(name, await adapter.getAllAsync(`SELECT * FROM ${name} ORDER BY rowid`));
  }

  contents.push(await adapter.getAllAsync("SELECT * FROM operation_log WHERE operation = 'update' ORDER BY id"));

  return JSON.stringify(contents);
}

/** The payload a rating row carries in operation_log, byte-identical to `enqueueSeasonRatingIntent`. */
function ratingPayload(grade: number, ratedAt: number): string {
  return JSON.stringify({ seasonId: 'season-1', grade, ratedAt });
}

/** One queued rating per status and failure kind, with `created_at` out of id order. */
const EVERY_STATUS: readonly QueuedRating[] = [
  { animeId: 'anime-1', nota: 1, status: 'pending', createdAt: 300, lastFailureKind: null },
  { animeId: 'anime-1', nota: 2, status: 'syncing', createdAt: 100, lastFailureKind: null },
  { animeId: 'anime-2', nota: 3, status: 'failed', createdAt: 100, lastFailureKind: 'auth_repair' },
  { animeId: 'anime-2', nota: 4, status: 'failed', createdAt: 200, lastFailureKind: 'conflict' },
  { animeId: 'anime-3', nota: 5, status: 'failed', createdAt: 210, lastFailureKind: 'not_found' },
  { animeId: 'anime-3', nota: 6, status: 'failed', createdAt: 220, lastFailureKind: 'rejected' },
  { animeId: 'anime-4', nota: 7, status: 'failed', createdAt: 230, lastFailureKind: 'unreachable' },
  { animeId: 'anime-4', nota: 8, status: 'failed', createdAt: 240, lastFailureKind: 'unexpected_response' },
  { animeId: 'anime-5', nota: 9, status: 'failed', createdAt: 250, lastFailureKind: null },
  // Only a `failed` row is given up: a kind left on a row that was retried says nothing.
  { animeId: 'anime-5', nota: 10, status: 'syncing', createdAt: 260, lastFailureKind: 'conflict' },
];

/** One expected moved row: anime, grade, created_at, status, unresolved reason. */
type Moved = readonly [string, number, number, string, string | null];

/** The move's output for `EVERY_STATUS`, in `created_at, id` order after the two anime rows. */
const EXPECTED_MOVED: readonly Moved[] = [
  ['anime-1', 2, 100, 'pending', null],
  ['anime-2', 3, 100, 'dead_letter', 'auth_repair'],
  ['anime-2', 4, 200, 'dead_letter', 'conflict'],
  ['anime-3', 5, 210, 'dead_letter', 'not_found'],
  ['anime-3', 6, 220, 'dead_letter', 'rejected'],
  ['anime-4', 7, 230, 'pending', null],
  ['anime-4', 8, 240, 'pending', null],
  ['anime-5', 9, 250, 'pending', null],
  ['anime-5', 10, 260, 'pending', null],
  ['anime-1', 1, 300, 'pending', null],
];

/** The full operation_log rows `EXPECTED_MOVED` stands for, numbered after the anime rows. */
function expectedRatingRows(): Record<string, unknown>[] {
  return EXPECTED_MOVED.map(([animeId, grade, createdAt, status, reason], index) => ({
    id: index + 3,
    anime_id: animeId,
    operation: 'season_rating',
    payload: ratingPayload(grade, createdAt + 1),
    status,
    created_at: createdAt,
    conflict_attempt_count: 0,
    claim_owner: null,
    claimed_at: null,
    unresolved_reason: reason,
  }));
}

describe('moving season_rating_queue into operation_log (ADR 009 L28, migration 0019)', () => {
  it('maps every status and failure kind, keeps created_at and numbers the rows in queue order', async () => {
    const adapter = await openInstalledDevice();
    await queueRatings(adapter, EVERY_STATUS);
    // A live claim from the old JS drain must not survive the move.
    await adapter.runAsync("UPDATE season_rating_queue SET claim_owner = 'js', claimed_at = 99 WHERE status = 'syncing'");
    const animeRows = (await readOperations(adapter)).slice(0, 2);

    await runMigrations(adapter);

    expect(await readOperations(adapter)).toEqual([...animeRows, ...expectedRatingRows()]);
    expect(await hasQueueTable(adapter)).toBe(false);
  });

  it('leaves the anime rows and every other table untouched', async () => {
    const adapter = await openInstalledDevice();
    // A first pass creates the repair-only tables, so the hash below compares like with like.
    await runMigrations(adapter);
    await recreateQueueTable(adapter);
    await queueRatings(adapter, EVERY_STATUS);
    const before = await hashUntouched(adapter);

    await runMigrations(adapter);

    expect(await hasQueueTable(adapter)).toBe(false);

    expect(await hashUntouched(adapter)).toBe(before);
  });

  it('is a no-op when it runs again', async () => {
    const adapter = await openInstalledDevice();
    await queueRatings(adapter, EVERY_STATUS);
    await runMigrations(adapter);
    const moved = await readOperations(adapter);

    await runMigrations(adapter);
    await moveSeasonRatingQueueIntoOperationLog(adapter);

    expect(await readOperations(adapter)).toEqual(moved);
  });

  it('moves a queue whose table predates the 0018 claim columns', async () => {
    const adapter = await openInstalledDevice('0017');
    await queueRatings(adapter, EVERY_STATUS.slice(0, 3));

    await runMigrations(adapter);

    expect((await readOperations(adapter)).slice(2).map((row) => [row.anime_id, row.status, row.unresolved_reason])).toEqual([
      ['anime-1', 'pending', null],
      ['anime-2', 'dead_letter', 'auth_repair'],
      ['anime-1', 'pending', null],
    ]);
    expect(await hasQueueTable(adapter)).toBe(false);
  });

  it('drops the table on a fresh install through migration 0019, with nothing to move', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);

    expect(await hasQueueTable(adapter)).toBe(false);

    await runMigrations(adapter);

    expect(await hasQueueTable(adapter)).toBe(false);
    expect(await readOperations(adapter)).toEqual([]);
  });

  it('brings a device stamped 19 with queued ratings to the current readiness (22) with them in operation_log', async () => {
    const adapter = await openInstalledDevice();
    await queueRatings(adapter, EVERY_STATUS);
    await adapter.execAsync('PRAGMA user_version = 19');

    await prepareForegroundDatabase(adapter);

    expect(await adapter.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 22 });
    expect((await readOperations(adapter)).slice(2)).toEqual(expectedRatingRows());
    expect(await hasQueueTable(adapter)).toBe(false);
  });

  it('rolls everything back when it fails after inserting, and the next launch retries', async () => {
    const adapter = await openInstalledDevice();
    await runMigrations(adapter);
    await recreateQueueTable(adapter);
    await queueRatings(adapter, EVERY_STATUS);
    const operationsBefore = await readOperations(adapter);
    const queueBefore = await adapter.getAllAsync('SELECT * FROM season_rating_queue ORDER BY id');
    // The process dies between the inserts and the drop.
    const crashing = new Proxy(adapter, {
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver);

        if (property !== 'runAsync' && property !== 'execAsync') {
          return member;
        }

        return (source: string, ...args: unknown[]) =>
          /^\s*DROP TABLE/iu.test(source)
            ? Promise.reject(new Error('process died'))
            : (member as (sql: string, ...rest: unknown[]) => Promise<unknown>).call(target, source, ...args);
      },
    });

    await expect(moveSeasonRatingQueueIntoOperationLog(crashing)).rejects.toThrow('process died');

    expect(await readOperations(adapter)).toEqual(operationsBefore);
    expect(await adapter.getAllAsync('SELECT * FROM season_rating_queue ORDER BY id')).toEqual(queueBefore);

    await runMigrations(adapter);

    expect((await readOperations(adapter)).slice(2)).toEqual(expectedRatingRows());
    expect(await hasQueueTable(adapter)).toBe(false);
  });
});
