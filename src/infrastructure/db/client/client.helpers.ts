import { desc } from "drizzle-orm";
import type { SQLiteDatabase } from "expo-sqlite";
import migrations from "../migrations/migrations";
import {
  getDrizzleFactory,
  getDrizzleMigrator,
  getOpenDatabaseSync,
} from "../native-runtime/native-runtime.helpers";
import * as schema from "../schema";
import { SQLITE_BUSY_TIMEOUT_MS, SYNC_CYCLE_LOCK_TABLE_SQL } from '../startup/startup.constants';

import {
  DATABASE_NAME,
  ERRCODE_PREFIX_PATTERN,
  SYNC_RUNTIME_STATUS_COLUMN_DEFINITIONS,
  WRITE_QUEUE_BY_DATABASE,
} from './client.constants';
import type {
  AppDatabase,
  LocalWriteFailureDiagnostics,
  LocalWriteFailureStage,
  MissingColumnDefinition,
  OpenAppDatabaseSyncParams,
} from './client.types';

/**
 * Extracts the SQLite primary errcode from a native write-failure message, or `null` when it
 * cannot be determined. A digit-shaped capture is treated as unparseable rather than assumed to
 * be Android's control byte: iOS's decimal rendering of the same field would collide with it for
 * any single-digit code, and silently reporting the wrong number is worse than admitting the
 * errcode is unknown.
 */
function parseSqliteErrcode(message: string): number | null {
  const match = ERRCODE_PREFIX_PATTERN.exec(message);
  if (!match) return null;

  const capturedCode = match[1];
  if (capturedCode.length !== 1 || /\d/.test(capturedCode)) {
    return null;
  }

  return capturedCode.charCodeAt(0);
}

/** A local SQLite write failure carrying observable diagnostics alongside the original message. */
export class LocalWriteError extends Error implements LocalWriteFailureDiagnostics {
  readonly errcode: number | null;
  readonly elapsedMs: number;
  readonly stage: LocalWriteFailureStage;

  constructor(message: string, diagnostics: LocalWriteFailureDiagnostics) {
    super(message);
    this.name = 'LocalWriteError';
    this.errcode = diagnostics.errcode;
    this.elapsedMs = diagnostics.elapsedMs;
    this.stage = diagnostics.stage;
  }
}

/**
 * Wraps a write-transaction failure into a `LocalWriteError`, copying `message` verbatim from the
 * cause so downstream copy (toast, persisted Settings tile) stays byte-identical. Diagnostics are
 * additive: `errcode`/`elapsedMs`/`stage` are observable only through the error's own fields, never
 * through the message text.
 */
export function toLocalWriteError(
  cause: unknown,
  startedAt: number,
  stage: LocalWriteFailureStage,
): LocalWriteError {
  const message = cause instanceof Error ? cause.message : String(cause);

  return new LocalWriteError(message, {
    errcode: parseSqliteErrcode(message),
    elapsedMs: Date.now() - startedAt,
    stage,
  });
}

/**
 * Applies the connection-local write-lock waiting policy synchronously, before any statement can
 * run on the connection. `busy_timeout` takes no lock and is purely connection-local, so applying
 * it via `execSync` is always safe -- including from a synchronous open path that cannot await.
 * `openAppDatabaseSync` is the implicit third open path H2 found running with no timeout at all;
 * `prepareForegroundDatabase`/`prepareHeadlessDatabase` (startup.helpers.ts) apply the same
 * pragma independently through the async API, which is idempotent against a connection already
 * covered here.
 */
export function applyConnectionPolicy(rawDb: SQLiteDatabase): void {
  rawDb.execSync(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
}

/** Executes the open app database sync operation. */
export function openAppDatabaseSync(options: OpenAppDatabaseSyncParams = {}) {
  const openDatabaseSync = getOpenDatabaseSync();
  const {
    enableChangeListener = true,
    useNewConnection = false,
  } = options;

  const rawDb = openDatabaseSync(DATABASE_NAME, {
    enableChangeListener,
    useNewConnection,
  });

  applyConnectionPolicy(rawDb);

  return rawDb;
}

/** Executes the create drizzle db operation. */
export function createDrizzleDb(rawDb: SQLiteDatabase) {
  const drizzle = getDrizzleFactory();
  return drizzle(rawDb, { schema });
}

async function ensureBridgeConfigLastChangelogId(rawDb: SQLiteDatabase) {
  const columns = await rawDb.getAllAsync<{ name: string }>('PRAGMA table_info(bridge_config)');
  const hasLastChangelogId = columns.some((column) => column.name === 'last_changelog_id');

  if (!hasLastChangelogId) {
    await rawDb.runAsync(
      'ALTER TABLE bridge_config ADD COLUMN last_changelog_id INTEGER DEFAULT 0'
    );
  }

  await rawDb.runAsync(
    "UPDATE bridge_config SET last_changelog_id = 0 WHERE last_changelog_id IS NULL OR typeof(last_changelog_id) NOT IN ('integer', 'real') OR last_changelog_id < 0 OR last_changelog_id > 1000000000000"
  );
}

async function ensureSyncRuntimeStatusExecutionColumns(rawDb: SQLiteDatabase) {
  const columns = await rawDb.getAllAsync<{ name: string }>('PRAGMA table_info(sync_runtime_status)');
  const columnNames = new Set(columns.map((column) => column.name));

  await ensureMissingColumns(
    rawDb,
    columnNames,
    SYNC_RUNTIME_STATUS_COLUMN_DEFINITIONS,
  );
}

/** Applies missing SQLite columns in declaration order while skipping existing columns. */
export async function ensureMissingColumns(
  rawDb: SQLiteDatabase,
  existingColumnNames: ReadonlySet<string>,
  definitions: readonly MissingColumnDefinition[],
): Promise<void> {
  const missingDefinitions = definitions.filter(
    (definition) => !existingColumnNames.has(definition.columnName),
  );

  await missingDefinitions.reduce<Promise<void>>(
    (previousMigration, definition) =>
      previousMigration
        .then(() => rawDb.runAsync(definition.sql))
        .then(() => undefined),
    Promise.resolve(),
  );
}

async function ensureOperationLogRetentionIndex(rawDb: SQLiteDatabase) {
  await rawDb.runAsync(
    'CREATE INDEX IF NOT EXISTS operation_log_status_created_at_idx ON operation_log(status, created_at, id)'
  );
}

/**
 * Adds the per-anime staleness-guard column when missing. The column is intentionally
 * nullable with no default and no backfill: NULL means "older than any remote change",
 * so every pre-existing row accepts the first remote change that targets it.
 */
async function ensureAnimesGuardColumn(rawDb: SQLiteDatabase) {
  const columns = await rawDb.getAllAsync<{ name: string }>('PRAGMA table_info(animes)');
  const hasGuardColumn = columns.some((column) => column.name === 'last_applied_change_ms');

  if (!hasGuardColumn) {
    await rawDb.runAsync(
      'ALTER TABLE animes ADD COLUMN last_applied_change_ms INTEGER'
    );
  }
}

/**
 * Creates the `pending_remote_changes` staging table when missing. Background/headless
 * sync runs (no reactive change listener, separate JS runtime) write remote changes here
 * instead of applying them to `animes` directly; a foreground drain hook later applies
 * them via the merge boundary on the shared reactive connection. `IF NOT EXISTS` keeps
 * reruns a no-op without needing a PRAGMA existence check first.
 */
async function ensurePendingRemoteChangesTable(rawDb: SQLiteDatabase) {
  await rawDb.runAsync(
    'CREATE TABLE IF NOT EXISTS pending_remote_changes (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'record_id TEXT NOT NULL, ' +
      'change_type TEXT NOT NULL, ' +
      'changed_fields TEXT NOT NULL, ' +
      'snapshot TEXT, ' +
      'timestamp INTEGER NOT NULL, ' +
      'created_at INTEGER NOT NULL)'
  );
}

async function ensureSeasonRatingQueueTable(rawDb: SQLiteDatabase) {
  await rawDb.runAsync(
    'CREATE TABLE IF NOT EXISTS season_rating_queue (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'season_id TEXT NOT NULL, ' +
      'anime_id TEXT NOT NULL, ' +
      'nota INTEGER NOT NULL, ' +
      'rated_at INTEGER NOT NULL, ' +
      "status TEXT NOT NULL DEFAULT 'pending', " +
      'created_at INTEGER NOT NULL, ' +
      'updated_at INTEGER NOT NULL, ' +
      'last_attempt_at INTEGER, ' +
      'last_failure_kind TEXT)'
  );

  await rawDb.runAsync(
    'CREATE INDEX IF NOT EXISTS season_rating_queue_status_created_at_idx ON season_rating_queue(status, created_at, id)'
  );
}

async function ensureActiveSeasonCacheTable(rawDb: SQLiteDatabase) {
  await rawDb.runAsync(
    'CREATE TABLE IF NOT EXISTS active_season_cache (' +
      'id INTEGER PRIMARY KEY CHECK (id = 1), ' +
      'season_id TEXT NOT NULL, ' +
      'candidates_json TEXT NOT NULL)'
  );
}

async function ensureSyncCycleLockTable(rawDb: SQLiteDatabase) {
  await rawDb.runAsync(SYNC_CYCLE_LOCK_TABLE_SQL);
}

async function prepareDatabaseSchema(rawDb: SQLiteDatabase) {
  const db = createDrizzleDb(rawDb);
  const migrate = getDrizzleMigrator();
  await migrate(db, migrations);
  await ensureBridgeConfigLastChangelogId(rawDb);
  await ensureSyncRuntimeStatusExecutionColumns(rawDb);
  await ensureOperationLogRetentionIndex(rawDb);
  await ensureAnimesGuardColumn(rawDb);
  await ensurePendingRemoteChangesTable(rawDb);
  await ensureSeasonRatingQueueTable(rawDb);
  await ensureActiveSeasonCacheTable(rawDb);
  await ensureSyncCycleLockTable(rawDb);
  return db;
}

/** Runs the foreground-owned migration and ordered legacy-repair pipeline. */
export function runMigrations(rawDb: SQLiteDatabase) {
  return prepareDatabaseSchema(rawDb);
}

/** Executes the get bridge config snapshot operation. */
export async function getBridgeConfigSnapshot(rawDb: SQLiteDatabase) {
  const db = createDrizzleDb(rawDb);
  const [config] = await db
    .select()
    .from(schema.bridgeConfig)
    .orderBy(desc(schema.bridgeConfig.id))
    .limit(1);

  return config ?? null;
}

/** Executes the clear bridge config operation. */
export async function clearBridgeConfig(rawDb: SQLiteDatabase) {
  await withDeferredWrite(rawDb, async (db) => {
    await db.delete(schema.bridgeConfig);
  });
}

async function withQueuedWrite<T>(
  rawDb: SQLiteDatabase,
  runWrite: () => Promise<T>,
) {
  // Keyed by the database FILE, not the connection object, so every connection opened against
  // the same file queues behind the same door (Design Decision 1).
  const queueKey = rawDb.databasePath ?? DATABASE_NAME;
  const previousWrite = WRITE_QUEUE_BY_DATABASE.get(queueKey) ?? Promise.resolve();

  const nextWrite = previousWrite.catch(() => undefined).then(runWrite);

  WRITE_QUEUE_BY_DATABASE.set(queueKey, nextWrite.catch(() => undefined));

  return nextWrite;
}

/**
 * Queues writes on the shared connection, one write door per database file (Design Decision 1/2).
 * The write lock is acquired UPFRONT via `BEGIN IMMEDIATE`, invoked through the async API, before
 * any synchronous drizzle statement runs -- so the busy wait lands on expo's native thread instead
 * of freezing JS (H2). `BEGIN` sits OUTSIDE the rollback guard: expo's own `withTransactionAsync`
 * rolls back a transaction that never began and masks the real error (design.md Statement Order).
 * A failing `ROLLBACK` never masks the original failure either.
 */
export async function withDeferredWrite<T>(
  rawDb: SQLiteDatabase,
  task: (db: AppDatabase, tx: SQLiteDatabase) => Promise<T>,
) {
  return withQueuedWrite(rawDb, async () => {
    const startedAt = Date.now();

    try {
      await rawDb.execAsync('BEGIN IMMEDIATE');
    } catch (error) {
      throw toLocalWriteError(error, startedAt, 'begin');
    }

    let taskCompleted = false;

    try {
      const result = await task(createDrizzleDb(rawDb), rawDb);
      taskCompleted = true;
      await rawDb.execAsync('COMMIT');
      return result;
    } catch (error) {
      try {
        await rawDb.execAsync('ROLLBACK');
      } catch {
        // Never mask the original failure with a rollback failure.
      }
      throw toLocalWriteError(error, startedAt, taskCompleted ? 'commit' : 'task');
    }
  });
}
