package expo.modules.syncengine

import android.content.Context
import android.database.DatabaseUtils
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
  /** The user's diagnostics-telemetry switch, already mapped onto its boolean meaning. */
  val isSyncTelemetryEnabled: Boolean = true,
)

/** Column carrying the user-owned diagnostics switch; mirrors `is_sync_telemetry_enabled`. */
const val BRIDGE_CONFIG_TELEMETRY_SWITCH_COLUMN = "is_sync_telemetry_enabled"

/**
 * Maps the STORED value of `bridge_config.is_sync_telemetry_enabled` onto the user's switch
 * position, mirroring `isSyncTelemetryEnabled` in `sync-telemetry-preference.helpers.ts` combined
 * with drizzle's boolean reader (`Number(value) === 1`):
 *
 * - `null` (the column is NULL) -> ENABLED: absence is not a choice, so a row that predates the
 *   column must not be silenced;
 * - a value that reads as exactly `1` -> ENABLED (`"1"`, `" 1 "`, `"1.0"`);
 * - every other stored value -- `""`, `"0"`, `"2"`, `"-1"`, and any text that is not a number --
 *   -> DISABLED. The direction is deliberate: a value the user never chose must never start a
 *   transmission, while a value that cannot be read at all is handled a level up, where the whole
 *   COLUMN is missing (see [readBridgeConfig]) and the config still reads as ENABLED.
 */
fun isSyncTelemetryEnabled(storedValue: String?): Boolean {
  // An explicit null check, not `storedValue?.trim() ?: return true`: the elvis would also branch
  // on `trim()` returning null, which cannot happen, and leave an unreachable branch in a CORE
  // class that must stay at 100 % branch coverage.
  if (storedValue == null) {
    return true
  }
  return storedValue.trim().toDoubleOrNull() == 1.0
}

/**
 * Reads the single `bridge_config` row; `null` when absent, or on a not-yet-migrated store.
 * Lives beside the other database plumbing so the cycle keeps to its pipeline shape.
 *
 * Two tolerances, both real on a device and both distinct:
 * - the telemetry-switch COLUMN may not exist yet (a store that predates that migration), in which
 *   case the config still reads and the absent switch reports ENABLED;
 * - the whole TABLE may not exist (a fresh install whose first foreground open has not run yet),
 *   in which case there is no config to read and the answer is `null` -- the same shape the cycle
 *   already handles as `not_applicable`, exactly like the JS side's `SchemaNotReadyError`
 *   tolerance. A missing schema must never surface as an exception out of a read whose KDoc
 *   promises `null`, which is what the nested tolerance below pins.
 */
fun readBridgeConfig(appDb: SQLiteDatabase): BridgeConfigRow? {
  return try {
    readBridgeConfigRow(appDb, withTelemetrySwitch = true)
  } catch (error: SQLiteException) {
    Log.w(TAG_DATABASE_READS, "bridge_config unreadable with the telemetry switch column", error)
    try {
      readBridgeConfigRow(appDb, withTelemetrySwitch = false)
    } catch (fallbackError: SQLiteException) {
      // Not one column missing but the whole table: a store that has not been provisioned yet.
      Log.w(TAG_DATABASE_READS, "bridge_config unreadable on this store", fallbackError)
      null
    }
  }
}

private const val BRIDGE_CONFIG_COLUMNS = "id, device_id, ip, port, token, last_changelog_id"

/**
 * One `bridge_config` read. [withTelemetrySwitch] `false` is the pre-migration fallback: the
 * config still reads, and the absent switch column reports ENABLED (see [isSyncTelemetryEnabled]).
 */
private fun readBridgeConfigRow(
  appDb: SQLiteDatabase,
  withTelemetrySwitch: Boolean,
): BridgeConfigRow? {
  val columns = if (withTelemetrySwitch) {
    "$BRIDGE_CONFIG_COLUMNS, $BRIDGE_CONFIG_TELEMETRY_SWITCH_COLUMN"
  } else {
    BRIDGE_CONFIG_COLUMNS
  }
  return appDb.rawQuery(
    "SELECT $columns FROM bridge_config ORDER BY id DESC LIMIT 1",
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
        isSyncTelemetryEnabled = !withTelemetrySwitch || cursor.isNull(6) ||
          isSyncTelemetryEnabled(cursor.getString(6)),
      )
    }
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
 * The app database readiness stamp the foreground writes as its FINAL schema-preparation step:
 * `prepareForegroundDatabase` runs `PRAGMA user_version = EXPECTED_SCHEMA_READINESS_VERSION` only
 * after migrations and full schema validation have succeeded, so a matching `user_version` is
 * durable proof that the schema is whole.
 *
 * This is the Kotlin TWIN of `EXPECTED_SCHEMA_READINESS_VERSION` in
 * `src/infrastructure/db/startup/startup.constants.ts`, which is itself
 * `migrationJournal.entries.length`. The value is a literal here because the native module cannot
 * import TypeScript; `tests/infrastructure/db/native-schema-readiness-twin.test.ts` reads this
 * file as text and fails when the literal drifts from the journal length, so a new migration
 * cannot silently block the native owner forever. Bump this value only with that test's help.
 */
const val EXPECTED_SCHEMA_READINESS_VERSION = 16

/**
 * Explicit verdict of the app database readiness probe. The decision itself ([resolveAppDatabaseReadiness])
 * does NO I/O, so every state is unit-testable without a device.
 *
 * - [NotProvisioned]: the database file does not exist yet. The native side must not create it;
 *   creation is the foreground's job (`prepareForegroundDatabase`).
 * - [SchemaNotReady]: the file exists but `PRAGMA user_version` is not the expected stamp, so the
 *   foreground has not durably finished preparing the schema (or is mid-migration right now).
 * - [Ready]: `PRAGMA user_version` equals the expected stamp. The foreground proved the schema is
 *   whole before writing it.
 */
enum class AppDatabaseReadiness {
  NotProvisioned,
  SchemaNotReady,
  Ready,
}

/**
 * Pure readiness decision from a file-existence flag and an already-read `PRAGMA user_version`.
 * Deliberately does NO I/O: [probeAppDatabaseReadiness] gathers the inputs and this function only
 * classifies them.
 *
 * The rule is EXACT equality: only the expected stamp is [AppDatabaseReadiness.Ready]. A `null`
 * version (the pragma could not be read) and any other number -- a behind-the-journal schema, or
 * an absurd/future version from a newer install -- are [AppDatabaseReadiness.SchemaNotReady],
 * never a guess.
 */
fun resolveAppDatabaseReadiness(
  fileExists: Boolean,
  userVersion: Int?,
  expectedVersion: Int,
): AppDatabaseReadiness {
  if (!fileExists) {
    return AppDatabaseReadiness.NotProvisioned
  }
  return if (userVersion == expectedVersion) {
    AppDatabaseReadiness.Ready
  } else {
    AppDatabaseReadiness.SchemaNotReady
  }
}

/**
 * Reads `PRAGMA user_version` from an EXISTING app database file through a READ-ONLY connection,
 * so it never creates the file and never takes a write lock. Returns `null` when the file cannot
 * be opened as a database (missing, not yet a valid SQLite file, or otherwise unreadable), which
 * [resolveAppDatabaseReadiness] treats as [AppDatabaseReadiness.SchemaNotReady].
 */
fun readAppDatabaseUserVersion(file: File): Int? {
  return try {
    SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { db ->
      DatabaseUtils.longForQuery(db, "PRAGMA user_version", null).toInt()
    }
  } catch (error: SQLiteException) {
    Log.w(TAG_DATABASE_READS, "app database user_version unreadable at $file", error)
    null
  }
}

/**
 * Probes the app database's readiness at the exact file expo-sqlite uses. A missing file returns
 * [AppDatabaseReadiness.NotProvisioned] WITHOUT opening anything; a present file is read through
 * the read-only [readAppDatabaseUserVersion]. This function never writes and never creates.
 */
fun probeAppDatabaseReadiness(context: Context): AppDatabaseReadiness {
  val file = resolveAppDatabaseFile(context)
  if (!file.exists()) {
    return resolveAppDatabaseReadiness(
      fileExists = false,
      userVersion = null,
      expectedVersion = EXPECTED_SCHEMA_READINESS_VERSION,
    )
  }
  return resolveAppDatabaseReadiness(
    fileExists = true,
    userVersion = readAppDatabaseUserVersion(file),
    expectedVersion = EXPECTED_SCHEMA_READINESS_VERSION,
  )
}

/**
 * Resolves the app database file at the exact location expo-sqlite uses (`filesDir/SQLite/`),
 * so the engine's connection sees the same file, WAL mode included, the app already wrote.
 */
fun resolveAppDatabaseFile(context: Context): File {
  val sqliteDirectory = File(context.filesDir, SQLITE_SUBDIRECTORY)
  return File(sqliteDirectory, APP_DATABASE_NAME)
}

/**
 * Deletes the application database TOGETHER WITH every SQLite sidecar file, through Android's own
 * SQLite deletion API -- the one call that removes `autoreas.db`, `-journal`, `-shm`, `-wal`, the
 * wipe-check file and every `-mj*` master journal as one unit.
 *
 * **Why expo-sqlite's own delete is not enough.** Expo SDK 55's JS `deleteDatabaseAsync` ends in
 * `SQLiteModule.deleteDatabase`, which is literally `File(dbFile).delete()`: it unlinks ONLY
 * `autoreas.db` and leaves the sidecars behind. A stale `-wal` beside a freshly created database
 * is exactly the corruption class this recovery feature exists to remove -- its frames can be
 * applied to the NEW file. Unlinking the sidecars by hand instead is not an option either: a WAL
 * must never be removed while it is open, and the API is what guarantees the files were not
 * recreated between the calls.
 *
 * **Why this is safe beside Expo's SQLite core in the same process.** [SQLiteDatabase.deleteDatabase]
 * is a PURE UNLINK: it opens NO connection, so this function cannot put a second independently
 * linked SQLite core in touch with `autoreas.db`, which is the hazard T3 removed by moving the
 * native owner into `:sync`. It is also why [SyncEngineModule] exposes this as the one destructive
 * entry point NOT covered by the `runOnce` main-process refusal: that refusal protects a call that
 * opens a framework connection, and this one opens nothing. Ordering still belongs to the caller --
 * every owner must be closed first -- and this function never expresses that as an assumption.
 *
 * Idempotent for a missing database: the API deletes what it finds, throws nothing when the files
 * are already gone, and reports `false`.
 *
 * @return `true` when the API removed at least one of the target files, `false` when there was
 * nothing left to remove. The `false` answer is NOT proof of damage: a `false` beside a surviving
 * file on disk is, which is why the reset adapter verifies the filesystem instead of trusting it.
 */
fun deleteAppDatabaseAndSidecars(context: Context): Boolean {
  return SQLiteDatabase.deleteDatabase(resolveAppDatabaseFile(context))
}

/**
 * Opens the engine's OWN connection to the app database. It never goes through the JS write
 * door (a JS-side queue cannot see this connection), so every transaction here carries its own
 * `BEGIN IMMEDIATE` and a bounded `busy_timeout` — the native equivalent of the door's bounds.
 */
fun openAppDatabase(context: Context): SQLiteDatabase {
  val file = resolveAppDatabaseFile(context)
  // `!!` (not `?.`, T3 sync-core-test-assurance): [resolveAppDatabaseFile] always builds `file`
  // via the two-argument `File(parent, child)` constructor, which Java guarantees never has a
  // null `getParentFile()` -- a `?.` here guarded an unreachable null branch. `!!` compiles to a
  // plain `Intrinsics.checkNotNull` call, not a local branch, so this removes the dead branch
  // instead of just relocating it (Kotlin's `File.getParentFile()` mapping IS `File?`, so a bare
  // unchecked call is a compile error here, unlike a true Java platform type).
  file.parentFile!!.mkdirs()
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
