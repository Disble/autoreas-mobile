package expo.modules.syncengine

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.File

/**
 * Shared constants for the native sync engine. Values here MUST stay aligned with their
 * TypeScript twins (referenced per constant): the engine and the JS cycle are two writers of
 * the same durable state until T8 retires the JS path, and a silent value drift between them
 * would make the background path behave differently from the foreground one.
 */

/** Owner stamped on the singleton `sync_cycle_lock` row when the engine claims it. */
const val ENGINE_LOCK_OWNER = "native_engine"

/** Lease duration for one claimed cycle; mirrors `DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS` (60 s). */
const val ENGINE_LEASE_MS = 60_000L

/**
 * Hard budget for one engine attempt. The watchdog fires at this point, writes the `abandoned`
 * journal row and resolves the pending promise itself — an unresolved promise is what burns the
 * platform's 600 s job budget, so this value MUST stay comfortably under that limit.
 */
const val ENGINE_BUDGET_MS = 30_000L

/** Connection-local lock-wait budget for the app database; mirrors `SQLITE_BUSY_TIMEOUT_MS`. */
const val APP_DB_BUSY_TIMEOUT_MS = 5_000L

/**
 * Watchdog/lease checks must never sit inside the work executor: the work thread may be parked
 * inside a native call, which is exactly why the watchdog lives on its own handler thread.
 */
const val WATCHDOG_THREAD_NAME = "SyncEngineWatchdog"

/** Name of the app database file, as expo-sqlite creates it; mirrors `DATABASE_NAME`. */
const val APP_DATABASE_NAME = "autoreas.db"

/** Subdirectory expo-sqlite stores database files in, relative to the app's `filesDir`. */
const val SQLITE_SUBDIRECTORY = "SQLite"

/**
 * Creates the `pending_remote_changes` staging table when missing. Byte-identical to the app's
 * own repair step (`ensurePendingRemoteChangesTable` in `client.helpers.ts`): the schema is
 * owned by the app's migration/repair pipeline and the engine must never invent its own shape —
 * it only reproduces the same idempotent DDL so a staging insert cannot fail on a device whose
 * first foreground open has not happened yet.
 */
const val PENDING_REMOTE_CHANGES_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS pending_remote_changes (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
    "record_id TEXT NOT NULL, " +
    "change_type TEXT NOT NULL, " +
    "changed_fields TEXT NOT NULL, " +
    "snapshot TEXT, " +
    "timestamp INTEGER NOT NULL, " +
    "created_at INTEGER NOT NULL)"

/**
 * Resolves the app database file at the exact location expo-sqlite uses (`filesDir/SQLite/`),
 * so the engine's connection sees the same file, WAL mode included, the app already wrote.
 */
fun resolveAppDatabaseFile(context: Context): File {
  val sqliteDirectory = File(context.filesDir, SQLITE_SUBDIRECTORY)
  return File(sqliteDirectory, APP_DATABASE_NAME)
}

/**
 * Opens the engine's OWN connection to the app database. It never goes through the JS write
 * door (a JS-side queue cannot see this connection), so every transaction here carries its own
 * `BEGIN IMMEDIATE` and a bounded `busy_timeout` — the native equivalent of the door's bounds.
 */
fun openAppDatabase(context: Context): SQLiteDatabase {
  val file = resolveAppDatabaseFile(context)
  file.parentFile?.mkdirs()
  val db = SQLiteDatabase.openOrCreateDatabase(file, null)
  db.compileStatement("PRAGMA busy_timeout = $APP_DB_BUSY_TIMEOUT_MS").execute()
  return db
}

/**
 * Runs [block] inside one `BEGIN IMMEDIATE` transaction with a matching `COMMIT`, or a
 * `ROLLBACK` that never masks the original failure. This is the native counterpart of the
 * write door's `withLocalWrite` transaction shape, without the JS queue.
 */
fun <T> inImmediateTransaction(db: SQLiteDatabase, block: () -> T): T {
  db.execSQL("BEGIN IMMEDIATE")
  return try {
    val result = block()
    db.execSQL("COMMIT")
    result
  } catch (error: Throwable) {
    try {
      db.execSQL("ROLLBACK")
    } catch (rollbackError: Throwable) {
      // Never mask the original failure with a rollback failure.
    }
    throw error
  }
}
