package expo.modules.syncengine

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.util.Log
import java.io.File

/**
 * Shared constants for the native sync engine. Values here MUST stay aligned with their
 * TypeScript twins (referenced per constant): the engine and the JS cycle are two writers of
 * the same durable state until T8 retires the JS path, and a silent value drift between them
 * would make the background path behave differently from the foreground one.
 */

/** Owner stamped on the singleton `sync_cycle_lock` row when the engine claims it. */
const val ENGINE_LOCK_OWNER = "native_engine"

/** Row id of the singleton `sync_cycle_lock` row; mirrors `SYNC_CYCLE_LOCK_ROW_ID`. */
const val ENGINE_LOCK_ROW_ID = 1L

/** Lease duration for one claimed cycle; mirrors `DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS` (60 s). */
const val ENGINE_LEASE_MS = 60_000L

/**
 * Hard budget for one engine attempt. The watchdog fires at this point, writes the `abandoned`
 * journal row and resolves the pending promise itself — an unresolved promise is what burns the
 * platform's 600 s job budget, so this value MUST stay comfortably under that limit.
 *
 * The budget is measured in WALL-CLOCK time: the watchdog compares against
 * `SystemClock.elapsedRealtime()` (counts time spent in deep sleep, unlike the
 * `uptimeMillis()` clock `Handler.postDelayed` delivers on), so a device suspension cannot
 * push the attempt past 30 s of wall clock without the watchdog firing at its next
 * schedulable moment.
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

/** Log tag for the database reads hosted in this file. */
const val TAG_DATABASE_READS = "SyncEngineDb"

/**
 * Ownership guard appended to every destructive or monotonic engine write over the app database:
 * the statement only affects rows while the singleton lease row still names the writer's exact
 * owner/fence pair. When a later attempt reclaimed the expired lease, the guard selects nothing
 * and the write affects zero rows -- a reclaimed lease rejects the previous owner's writes
 * (ADR 008) instead of only preventing new claims.
 *
 * Bind order for a guarded statement: the statement's own placeholders first, then the owner,
 * then the fence.
 */
const val LEASE_OWNERSHIP_GUARD_SQL =
  "EXISTS (SELECT 1 FROM sync_cycle_lock WHERE id = $ENGINE_LOCK_ROW_ID AND owner = ? AND fence = ?)"

/**
 * Reads the singleton lease row's `owner` and `fence` back and reports whether they name exactly
 * [owner] and [fence]. The stored pair is the single source of truth for who holds the lease.
 * A missing `sync_cycle_lock` table reads as not-owned rather than throwing.
 */
fun isSyncCycleLeaseOwnedBy(appDb: SQLiteDatabase, owner: String, fence: String): Boolean {
  return try {
    appDb.rawQuery(READ_OWNERSHIP_SQL, arrayOf(ENGINE_LOCK_ROW_ID.toString())).use { cursor ->
      cursor.moveToFirst() &&
        cursor.getString(0) == owner &&
        !cursor.isNull(1) &&
        cursor.getString(1) == fence
    }
  } catch (error: SQLiteException) {
    false
  }
}

private const val READ_OWNERSHIP_SQL = "SELECT owner, fence FROM sync_cycle_lock WHERE id = ?"

/**
 * Verifies lease ownership for a whole write transaction, throwing [LeaseLostException] when the
 * lease no longer names this attempt. Sound as a transaction-wide guard: the caller runs inside
 * `BEGIN IMMEDIATE`, and another connection's reclaim is itself a write, so the write lock pins
 * the fence for the entire transaction -- no claim can interleave between this check and COMMIT.
 */
fun requireLeaseOwnership(appDb: SQLiteDatabase, lease: LeaseFence) {
  if (!isSyncCycleLeaseOwnedBy(appDb, lease.owner, lease.fence)) {
    throw LeaseLostException("lease row no longer names owner=${lease.owner}")
  }
}

/** The `bridge_config` columns the engine reads (single row, newest id). */
data class BridgeConfigRow(
  val id: Long,
  val deviceId: String?,
  val ip: String?,
  val port: String?,
  val token: String?,
  val lastChangelogId: Long?,
)

/**
 * Reads the single `bridge_config` row; `null` when absent, or on a not-yet-migrated store.
 * Lives beside the other database plumbing so the cycle keeps to its pipeline shape.
 */
fun readBridgeConfig(appDb: SQLiteDatabase): BridgeConfigRow? {
  return try {
    appDb.rawQuery(
      "SELECT id, device_id, ip, port, token, last_changelog_id FROM bridge_config " +
        "ORDER BY id DESC LIMIT 1",
      null,
    ).use { cursor ->
      if (!cursor.moveToFirst()) {
        null
      } else {
        BridgeConfigRow(
          id = cursor.getLong(0),
          deviceId = cursor.getString(1),
          ip = cursor.getString(2),
          port = cursor.getString(3),
          token = cursor.getString(4),
          lastChangelogId = if (cursor.isNull(5)) null else cursor.getLong(5),
        )
      }
    }
  } catch (error: SQLiteException) {
    // A fresh install has no schema until the foreground's first open; mirror the JS
    // SchemaNotReadyError -> no-op handling with `not_applicable`.
    Log.w(TAG_DATABASE_READS, "bridge_config unreadable (schema not ready?)", error)
    null
  }
}

/** Reports whether a read config carries everything one attempt needs to reach the bridge. */
fun hasCompleteBridgeConnection(config: BridgeConfigRow): Boolean {
  return !config.deviceId.isNullOrBlank() &&
    !config.ip.isNullOrBlank() &&
    !config.port.isNullOrBlank() &&
    !config.token.isNullOrBlank()
}

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
