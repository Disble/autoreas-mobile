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
import { withDeadline } from '../../async/deadline.helpers';
import { DeadlineExceededError } from '../../async/deadline.errors';
import { LocalWriteError } from './client.errors';

import {
  ANIMES_COLUMN_DEFINITIONS,
  BRIDGE_CONFIG_COLUMN_DEFINITIONS,
  DATABASE_NAME,
  LOCAL_WRITE_DEADLINE_MS,
  ERRCODE_PREFIX_PATTERN,
  MAX_JOURNAL_MIGRATION_TIMESTAMP_MS,
  MIGRATION_JOURNAL_TIMESTAMPS_MS,
  MIGRATION_LEDGER_SELECT_SQL,
  MIGRATION_LEDGER_TABLE_LOOKUP_SQL,
  MIGRATION_LEDGER_UPDATE_SQL,
  OPERATION_LOG_COLUMN_DEFINITIONS,
  SYNC_RUNTIME_STATUS_COLUMN_DEFINITIONS,
  WRITE_QUEUE_BY_DATABASE,
} from './client.constants';
import type {
  AppDatabase,
  LocalWriteFailureStage,
  MigrationLedgerRow,
  MissingColumnDefinition,
  OpenAppDatabaseSyncParams,
  OpenTelemetryDatabaseSyncParams,
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
export function applyConnectionPolicy(
  rawDb: SQLiteDatabase,
  busyTimeoutMs: number = SQLITE_BUSY_TIMEOUT_MS,
): void {
  rawDb.execSync(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
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

/**
 * Opens a SQLite file that is NOT the app database, with its own lock-wait budget.
 *
 * Kept separate from `openAppDatabaseSync` rather than folded into it as an optional name: every
 * write-door invariant in this file is reasoned about in terms of ONE app file, and a caller that
 * could quietly repoint that opener at another name would make those invariants unverifiable.
 * Deliberately returns a connection that no `withLocalWrite` ever touches -- the write queue is
 * keyed by path, so a side file must stay outside the door entirely to be worth having.
 */
export function openTelemetryDatabaseSync(
  options: OpenTelemetryDatabaseSyncParams,
): SQLiteDatabase {
  const openDatabaseSync = getOpenDatabaseSync();
  const rawDb = openDatabaseSync(options.databaseName, {
    enableChangeListener: options.enableChangeListener,
    useNewConnection: options.useNewConnection,
  });

  applyConnectionPolicy(rawDb, options.busyTimeoutMs);

  return rawDb;
}

/** Executes the create drizzle db operation. */
export function createDrizzleDb(rawDb: SQLiteDatabase) {
  const drizzle = getDrizzleFactory();
  return drizzle(rawDb, { schema });
}

/**
 * Adds the `last_changelog_id` cursor column to legacy `bridge_config` rows that predate it, then
 * backfills every later `bridge_config` telemetry column (`BRIDGE_CONFIG_COLUMN_DEFINITIONS`) off
 * the same `PRAGMA table_info` read -- these columns carry no migration-independent twin, so a
 * device that skipped their migration relies entirely on this repair step to catch up.
 */
async function ensureBridgeConfigLastChangelogId(rawDb: SQLiteDatabase) {
  const columns = await rawDb.getAllAsync<{ name: string }>('PRAGMA table_info(bridge_config)');
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('last_changelog_id')) {
    await rawDb.runAsync(
      'ALTER TABLE bridge_config ADD COLUMN last_changelog_id INTEGER DEFAULT 0'
    );
  }

  await rawDb.runAsync(
    "UPDATE bridge_config SET last_changelog_id = 0 WHERE last_changelog_id IS NULL OR typeof(last_changelog_id) NOT IN ('integer', 'real') OR last_changelog_id < 0 OR last_changelog_id > 1000000000000"
  );

  await ensureMissingColumns(rawDb, columnNames, BRIDGE_CONFIG_COLUMN_DEFINITIONS);
}

/** Backfills the sync-runtime status columns added after the table first shipped. */
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

/** Creates the index the bounded operation-log backlog and retention queries rely on. */
async function ensureOperationLogRetentionIndex(rawDb: SQLiteDatabase) {
  await rawDb.runAsync(
    'CREATE INDEX IF NOT EXISTS operation_log_status_created_at_idx ON operation_log(status, created_at, id)'
  );
}

/**
 * Adds every `animes` column added after the table first shipped, mirroring
 * `ensureBridgeConfigLastChangelogId`'s single-PRAGMA-read mechanism. Both current columns are
 * intentionally nullable with no default and no backfill: NULL means "older than any remote
 * change" for the staleness guard, and "no bridge token known yet" for the OCC token, so every
 * pre-existing row accepts the first remote change / stays untouched until its first confirmed
 * write, respectively -- never a fabricated value that could be mistaken for a real one.
 */
async function ensureAnimesColumns(rawDb: SQLiteDatabase) {
  const columns = await rawDb.getAllAsync<{ name: string }>('PRAGMA table_info(animes)');
  const columnNames = new Set(columns.map((column) => column.name));

  await ensureMissingColumns(rawDb, columnNames, ANIMES_COLUMN_DEFINITIONS);
}

/**
 * Adds every `operation_log` column added after the table first shipped, mirroring
 * `ensureAnimesColumns`'s single-PRAGMA-read mechanism. Unlike the `animes` OCC columns,
 * `conflict_attempt_count` is NOT NULL with a default of 0 (design.md Decision 6) -- every
 * pre-existing queued row can safely read back "zero conflicts so far".
 */
async function ensureOperationLogColumns(rawDb: SQLiteDatabase) {
  const columns = await rawDb.getAllAsync<{ name: string }>('PRAGMA table_info(operation_log)');
  const columnNames = new Set(columns.map((column) => column.name));

  await ensureMissingColumns(rawDb, columnNames, OPERATION_LOG_COLUMN_DEFINITIONS);
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

/** Creates the durable season-rating queue for installs that predate it. */
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

/** Creates the single-row active-season cache. Exists in no migration file; only here. */
async function ensureActiveSeasonCacheTable(rawDb: SQLiteDatabase) {
  await rawDb.runAsync(
    'CREATE TABLE IF NOT EXISTS active_season_cache (' +
      'id INTEGER PRIMARY KEY CHECK (id = 1), ' +
      'season_id TEXT NOT NULL, ' +
      'candidates_json TEXT NOT NULL)'
  );
}

/** Creates the advisory sync-cycle lock table. Exists in no migration file; only here. */
async function ensureSyncCycleLockTable(rawDb: SQLiteDatabase) {
  await rawDb.runAsync(SYNC_CYCLE_LOCK_TABLE_SQL);
}

/**
 * Resolves what one `__drizzle_migrations` row's `created_at` MUST hold, given its ledger position
 * and what it currently holds.
 *
 * `drizzle-orm`'s migrator (`sqlite-core/dialect.cjs`) decides what to apply with ONE scalar
 * comparison against the single MAXIMUM `created_at` already stored -- it tracks neither tag nor
 * hash. That makes the stored maximum a load-bearing value in both directions:
 *
 * - Dragging it DOWN re-runs every migration above it, and `ALTER TABLE ... ADD COLUMN` is not
 *   idempotent, so the re-run aborts the whole migration transaction with `duplicate column name`
 *   and bricks startup on every launch. A stored value below its own journal entry can only be
 *   damage, so this RAISES it back.
 * - Leaving a value ABOVE every journal entry skips every migration silently. No journal could
 *   have written such a value, so it is migration 0006's hand-typed future `when` (2026-09-20)
 *   still sitting on the device; this pins it to the journal maximum, which parks the gate instead
 *   of re-running migrations whose columns the idempotent repair steps below have long since
 *   created.
 *
 * Never lowers anything else: a row already at or above its journal entry is left exactly as it is.
 */
export function resolveMigrationLedgerTimestamp(
  ledgerIndex: number,
  storedCreatedAt: number,
): number {
  if (storedCreatedAt > MAX_JOURNAL_MIGRATION_TIMESTAMP_MS) {
    return MAX_JOURNAL_MIGRATION_TIMESTAMP_MS;
  }

  const journalTimestamp = MIGRATION_JOURNAL_TIMESTAMPS_MS[ledgerIndex];

  if (journalTimestamp === undefined || journalTimestamp <= storedCreatedAt) {
    return storedCreatedAt;
  }

  return journalTimestamp;
}

/**
 * Reconciles the migrator's ledger with the journal before `migrate()` reads its gate, one row at
 * a time by insertion ordinal. Guarded on `sqlite_master` so a fresh install with no
 * `__drizzle_migrations` table yet is a clean no-op, and it writes only the rows that actually
 * disagree with the journal.
 */
async function reconcileMigrationLedger(rawDb: SQLiteDatabase): Promise<void> {
  const migrationsTable = await rawDb.getFirstAsync<{ name: string }>(
    MIGRATION_LEDGER_TABLE_LOOKUP_SQL
  );

  if (!migrationsTable) return;

  const rows = await rawDb.getAllAsync<MigrationLedgerRow>(MIGRATION_LEDGER_SELECT_SQL);

  await rows.reduce<Promise<void>>(
    (previousRow, row, ledgerIndex) =>
      previousRow.then(async () => {
        const storedCreatedAt = Number(row.created_at);
        const resolved = resolveMigrationLedgerTimestamp(ledgerIndex, storedCreatedAt);

        if (resolved === storedCreatedAt) return;

        await rawDb.runAsync(MIGRATION_LEDGER_UPDATE_SQL, resolved, row.rowid);
      }),
    Promise.resolve(),
  );
}

/**
 * Brings a connection's schema to the shape the app expects: the drizzle migrator first, then
 * ordered idempotent repair steps for everything migrations cannot express. Two REQUIRED_SCHEMA
 * tables -- `active_season_cache` and `sync_cycle_lock` -- exist ONLY as repair steps, so running
 * the migration files alone leaves a database that fails readiness.
 */
async function prepareDatabaseSchema(rawDb: SQLiteDatabase) {
  const db = createDrizzleDb(rawDb);
  const migrate = getDrizzleMigrator();
  await reconcileMigrationLedger(rawDb);
  await migrate(db, migrations);
  await ensureBridgeConfigLastChangelogId(rawDb);
  await ensureSyncRuntimeStatusExecutionColumns(rawDb);
  await ensureOperationLogRetentionIndex(rawDb);
  await ensureAnimesColumns(rawDb);
  await ensureOperationLogColumns(rawDb);
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
  await withLocalWrite(rawDb, async (db) => {
    await db.delete(schema.bridgeConfig);
  });
}

/**
 * Serializes one write behind every earlier write to the same database FILE, and bounds only the
 * CALLER's view of it. The queue deliberately chains on the real write rather than the bounded
 * one -- see the comment inside for why a deadline must never open the door.
 */
async function withQueuedWrite<T>(
  rawDb: SQLiteDatabase,
  runWrite: () => Promise<T>,
) {
  // Keyed by the database FILE, not the connection object, so every connection opened against
  // the same file queues behind the same door (Design Decision 1).
  const queueKey = rawDb.databasePath ?? DATABASE_NAME;
  const previousWrite = WRITE_QUEUE_BY_DATABASE.get(queueKey) ?? Promise.resolve();
  const queuedAt = Date.now();

  const nextWrite = previousWrite.catch(() => undefined).then(runWrite);

  // The queue chains on the REAL write, never on the bounded view below. This is the whole
  // point: a deadline must NOT admit a successor. `withLocalWrite` issues BEGIN IMMEDIATE on the
  // connection and a JS timer cannot cancel native SQLite work, so opening the door on expiry
  // would start a second transaction on a connection that already has one open -- the
  // SQLITE_BUSY_SNAPSHOT class this file-keyed door exists to prevent. A visible deadlock is the
  // correct outcome; two concurrent transactions is not.
  WRITE_QUEUE_BY_DATABASE.set(queueKey, nextWrite.catch(() => undefined));

  try {
    return await withDeadline({
      operation: () => nextWrite,
      timeoutMs: LOCAL_WRITE_DEADLINE_MS,
      label: 'local_write',
    });
  } catch (error) {
    // `queuedAt` is taken when the write is QUEUED, not when its transaction begins, so a caller
    // stuck behind a jammed door sees the wait it actually experienced instead of a near-zero
    // number that hides the stall.
    throw error instanceof DeadlineExceededError
      ? toLocalWriteError(error, queuedAt, 'deadline')
      : error;
  }
}

/**
 * Queues writes on the shared connection, one write door per database file (Design Decision 1/2).
 * The write lock is acquired UPFRONT via `BEGIN IMMEDIATE`, invoked through the async API, before
 * any synchronous drizzle statement runs -- so the busy wait lands on expo's native thread instead
 * of freezing JS (H2). `BEGIN` sits OUTSIDE the rollback guard: expo's own `withTransactionAsync`
 * rolls back a transaction that never began and masks the real error (design.md Statement Order).
 * A failing `ROLLBACK` never masks the original failure either.
 */
export async function withLocalWrite<T>(
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
