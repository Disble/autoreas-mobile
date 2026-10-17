import type { SQLiteDatabase } from 'expo-sqlite';
import journal from '../../../src/infrastructure/db/migrations/meta/_journal.json';
import { enqueueSeasonRatingIntent } from '../../../src/features/sync/season-rating-intent.helpers';
import { prepareForegroundDatabase } from '../../../src/infrastructure/db/startup/startup.helpers';
import { GATE_MIGRATOR_LOG, V1_12_0_READINESS_VERSION } from '../../support/migration-gate.constants';
import {
  createCrashingAdapter,
  dumpDatabase,
  openV1120Device,
  readUserVersion,
} from '../../support/migration-gate.helpers';
import type { DatabaseDump } from '../../support/migration-gate.types';
import { createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

// Unlike `season-rating-queue-move.test.ts`, the migrator here is drizzle's REAL single-scalar gate:
// the upgrade proves that the gate applies nothing on an installed device and the repair step alone
// converges it.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/migration-gate.helpers').createUnwrappingDrizzleFactory(),
  getDrizzleMigrator: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/migration-gate.helpers').createGateMigrator(),
  getOpenDatabaseSync: () => () => undefined,
}));

/** One `season_rating_queue` row at its migration-0009 shape, as a v1.12.0 device stored it. */
interface QueuedRating {
  readonly seasonId: string;
  readonly animeId: string;
  readonly nota: number;
  readonly ratedAt: number;
  readonly status: string;
  readonly createdAt: number;
  readonly lastFailureKind: string | null;
  /** The status and unresolved reason the move must give it. */
  readonly moved: readonly [string, string | null];
}

/** Every status and failure kind v1.12.0 could leave, plus a ghost anime; `created_at` out of id order. */
const QUEUED: readonly QueuedRating[] = [
  { seasonId: 'season-1', animeId: 'anime-1', nota: 1, ratedAt: 1_690_000_000_001, status: 'pending', createdAt: 3000, lastFailureKind: null, moved: ['pending', null] },
  { seasonId: 'season-1', animeId: 'anime-1', nota: 10, ratedAt: 1_690_000_000_002, status: 'pending', createdAt: 900, lastFailureKind: 'unreachable', moved: ['pending', null] },
  { seasonId: 'season-1', animeId: 'anime-2', nota: 0, ratedAt: 1_690_000_000_003, status: 'pending', createdAt: 1000, lastFailureKind: 'unexpected_response', moved: ['pending', null] },
  { seasonId: 'season-1', animeId: 'anime-2', nota: 5, ratedAt: 1_690_000_000_004, status: 'syncing', createdAt: 1000, lastFailureKind: null, moved: ['pending', null] },
  { seasonId: 'season-0', animeId: 'ghost', nota: 7, ratedAt: 0, status: 'failed', createdAt: 1100, lastFailureKind: 'auth_repair', moved: ['dead_letter', 'auth_repair'] },
  { seasonId: 'season-1', animeId: 'anime-1', nota: 2, ratedAt: 1_690_000_000_005, status: 'failed', createdAt: 1200, lastFailureKind: 'conflict', moved: ['dead_letter', 'conflict'] },
  { seasonId: 'season-1', animeId: 'anime-2', nota: 9, ratedAt: 1_690_000_000_006, status: 'failed', createdAt: 1300, lastFailureKind: 'not_found', moved: ['dead_letter', 'not_found'] },
  { seasonId: 'season-1', animeId: 'anime-2', nota: 3, ratedAt: 1_690_000_000_007, status: 'failed', createdAt: 1400, lastFailureKind: 'rejected', moved: ['dead_letter', 'rejected'] },
  { seasonId: 'season-1', animeId: 'anime-1', nota: 4, ratedAt: 1_690_000_000_008, status: 'failed', createdAt: 1500, lastFailureKind: 'unreachable', moved: ['pending', null] },
  { seasonId: 'season-1', animeId: 'anime-1', nota: 6, ratedAt: 1_690_000_000_009, status: 'failed', createdAt: 1600, lastFailureKind: null, moved: ['pending', null] },
  // Only a `failed` row is given up: a kind left on a retried or unknown-status row says nothing.
  { seasonId: 'season-1', animeId: 'anime-1', nota: 8, ratedAt: 1_690_000_000_010, status: 'syncing', createdAt: 1700, lastFailureKind: 'conflict', moved: ['pending', null] },
  { seasonId: 'season-1', animeId: 'anime-2', nota: 2, ratedAt: 1_690_000_000_011, status: 'weird_status', createdAt: 1800, lastFailureKind: 'rejected', moved: ['pending', null] },
];

/** The ids `QUEUED` rows get (1-based insertion order), sorted the way the move reads them. */
const MOVE_ORDER: readonly number[] = QUEUED.map((rating, index) => ({ rating, id: index + 1 }))
  .sort((left, right) => left.rating.createdAt - right.rating.createdAt || left.id - right.id)
  .map(({ id }) => id);

/** The columns of a moved `season_rating` operation the test compares. */
const RATING_COLUMNS =
  'anime_id, operation, payload, status, created_at, conflict_attempt_count, claim_owner, claimed_at, unresolved_reason';

/** The columns every pre-existing anime operation keeps, compared before and after. */
const ANIME_OPERATION_COLUMNS = 'id, anime_id, operation, payload, status, created_at';

/** The tables the upgrade is allowed to change; every other table must stay byte-identical. */
const CHANGED_TABLES: readonly string[] = ['operation_log', 'season_rating_queue', '__drizzle_migrations'];

/** The newest `when` the shipped journal holds: the scalar the upgrade pins the ledger to. */
const JOURNAL_MAX_WHEN = Math.max(...journal.entries.map((entry) => entry.when));

/** Builds a v1.12.0 device holding bridge config, anime rows, anime operations and `QUEUED`. */
async function openSeededDevice(): Promise<SQLiteDatabase> {
  const adapter = await openV1120Device();
  await adapter.runAsync(
    "INSERT INTO bridge_config (id, ip, port, token, device_id, last_changelog_id) VALUES (1, '192.168.0.10', 8080, 'tok', 'dev-1', 5)",
  );
  await adapter.runAsync(
    "INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez) VALUES ('anime-1', 'Uno', 0, 4, 1, 1), ('anime-2', 'Dos', 1, 9, 1, 0)",
  );
  await adapter.runAsync(
    "INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES ('anime-1', 'update', '{\"episodesWatched\":5}', 'pending', 50), ('anime-2', 'update', '{\"estado\":1}', 'dead_letter', 60), ('anime-1', 'update', '{\"episodesWatched\":4}', 'synced', 40)",
  );

  for (const rating of QUEUED) {
    await adapter.runAsync(
      'INSERT INTO season_rating_queue (season_id, anime_id, nota, rated_at, status, created_at, updated_at, last_failure_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      rating.seasonId,
      rating.animeId,
      rating.nota,
      rating.ratedAt,
      rating.status,
      rating.createdAt,
      rating.createdAt + 5,
      rating.lastFailureKind,
    );
  }

  return adapter;
}

/** The payload `enqueueSeasonRatingIntent` writes for `rating`, read back from a fresh install. */
async function enqueuedPayload(rating: QueuedRating): Promise<string> {
  const fresh = createTestSqliteAdapter();
  await prepareForegroundDatabase(fresh);
  await enqueueSeasonRatingIntent(
    fresh,
    { seasonId: rating.seasonId, animeId: rating.animeId, nota: rating.nota, ratedAt: rating.ratedAt },
    { now: () => 1 },
  );
  const row = await fresh.getFirstAsync<{ payload: string }>('SELECT payload FROM operation_log');

  return String(row?.payload);
}

/** The rows the move must append, in move order, with payloads a fresh enqueue writes. */
async function expectedMovedRows(): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];

  for (const id of MOVE_ORDER) {
    const rating = QUEUED[id - 1];
    rows.push({
      anime_id: rating.animeId,
      operation: 'season_rating',
      payload: await enqueuedPayload(rating),
      status: rating.moved[0],
      created_at: rating.createdAt,
      conflict_attempt_count: 0,
      claim_owner: null,
      claimed_at: null,
      unresolved_reason: rating.moved[1],
    });
  }

  return rows;
}

/** Reads every `season_rating` operation in id order. */
function readRatings(adapter: SQLiteDatabase) {
  return adapter.getAllAsync(`SELECT ${RATING_COLUMNS} FROM operation_log WHERE operation = 'season_rating' ORDER BY id`);
}

/** Reads every anime operation on the columns it held before the upgrade. */
function readAnimeOperations(adapter: SQLiteDatabase) {
  return adapter.getAllAsync(
    `SELECT ${ANIME_OPERATION_COLUMNS} FROM operation_log WHERE operation <> 'season_rating' ORDER BY id`,
  );
}

/** Reads every queued row, untouched, in id order. */
function readQueue(adapter: SQLiteDatabase) {
  return adapter.getAllAsync('SELECT * FROM season_rating_queue ORDER BY id');
}

/** The rows of every table outside `CHANGED_TABLES`. */
function untouchedTables(dump: DatabaseDump): Record<string, readonly unknown[]> {
  return Object.fromEntries(Object.entries(dump.tables).filter(([name]) => !CHANGED_TABLES.includes(name)));
}

/**
 * The database a startup leaves when it dies right before the move's transaction begins: the idempotent
 * repairs that run earlier (columns, ledger pin) have committed, the move has touched nothing. A crash
 * inside the move must leave exactly this, byte for byte.
 */
async function dumpStartupStoppedBeforeTheMove(): Promise<DatabaseDump> {
  const adapter = await openSeededDevice();
  const crashing = createCrashingAdapter(adapter, (source) => /^\s*BEGIN EXCLUSIVE/.test(source));
  await expect(prepareForegroundDatabase(crashing)).rejects.toThrow('injected failure');

  return dumpDatabase(adapter);
}

/** Reads every ledger `created_at`, the scalars the gate decides from. */
async function readLedger(adapter: SQLiteDatabase): Promise<number[]> {
  const rows = await adapter.getAllAsync<{ created_at: number }>('SELECT created_at FROM __drizzle_migrations ORDER BY rowid');

  return rows.map((row) => Number(row.created_at));
}

describe('season rating queue upgrade through the real drizzle gate', () => {
  beforeEach(() => {
    GATE_MIGRATOR_LOG.length = 0;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds a v1.12.0 device: queue at its 0009 shape, ledger pinned to 0017, readiness 18', async () => {
    const adapter = await openSeededDevice();
    const columns = await adapter.getAllAsync<{ name: string }>('PRAGMA table_info(season_rating_queue)');

    expect(await readUserVersion(adapter)).toBe(V1_12_0_READINESS_VERSION);
    expect(columns.map((column) => column.name)).not.toContain('claim_owner');
    expect(await readLedger(adapter)).toEqual(Array.from({ length: 18 }, () => 1789310400000));
  });

  it('moves the whole queue while the real gate applies nothing, and stamps readiness 20', async () => {
    const adapter = await openSeededDevice();
    const expected = await expectedMovedRows();
    const animeOperations = await readAnimeOperations(adapter);
    const before = await dumpDatabase(adapter);
    GATE_MIGRATOR_LOG.length = 0;

    await prepareForegroundDatabase(adapter);
    const after = await dumpDatabase(adapter);

    expect(GATE_MIGRATOR_LOG).toEqual([[]]);
    expect(await readUserVersion(adapter)).toBe(20);
    expect(await readRatings(adapter)).toEqual(expected);
    expect(await readAnimeOperations(adapter)).toEqual(animeOperations);
    expect(untouchedTables(after)).toEqual(untouchedTables(before));
    expect(after.schema.some((entry) => entry.tbl_name === 'season_rating_queue')).toBe(false);
    expect(await readLedger(adapter)).toEqual(Array.from({ length: 18 }, () => JOURNAL_MAX_WHEN));
  });

  it('makes a second startup a full no-op that never reaches the migrator', async () => {
    const adapter = await openSeededDevice();
    await prepareForegroundDatabase(adapter);
    const upgraded = await dumpDatabase(adapter);
    GATE_MIGRATOR_LOG.length = 0;

    await prepareForegroundDatabase(adapter);

    expect(GATE_MIGRATOR_LOG).toEqual([]);
    expect(await dumpDatabase(adapter)).toEqual(upgraded);
    expect(await readUserVersion(adapter)).toBe(20);
  });

  it('rolls the whole move back at readiness 18 when the DROP crashes, and the next startup completes', async () => {
    const adapter = await openSeededDevice();
    const expected = await expectedMovedRows();
    const queue = await readQueue(adapter);
    const animeOperations = await readAnimeOperations(adapter);
    const before = await dumpDatabase(adapter);
    const stoppedBeforeTheMove = await dumpStartupStoppedBeforeTheMove();
    const crashing = createCrashingAdapter(adapter, (source) => /^\s*DROP TABLE season_rating_queue/.test(source));

    await expect(prepareForegroundDatabase(crashing)).rejects.toThrow('injected failure');

    expect(await readUserVersion(adapter)).toBe(V1_12_0_READINESS_VERSION);
    expect(await readQueue(adapter)).toEqual(queue);
    expect(await readRatings(adapter)).toEqual([]);
    expect(await readAnimeOperations(adapter)).toEqual(animeOperations);
    expect(untouchedTables(await dumpDatabase(adapter))).toEqual(untouchedTables(before));
    expect(await dumpDatabase(adapter)).toEqual(stoppedBeforeTheMove);

    await prepareForegroundDatabase(adapter);

    expect(await readUserVersion(adapter)).toBe(20);
    expect(await readRatings(adapter)).toEqual(expected);
    expect(await readAnimeOperations(adapter)).toEqual(animeOperations);
  });
});
