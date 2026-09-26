package expo.modules.syncengine

import android.content.ContextWrapper
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.util.UUID
import org.robolectric.RuntimeEnvironment

/**
 * Small isolated native-SQLite fixture for tests that exercise engine database and journal effects.
 *
 * [appDatabase] is in-memory by default, which keeps every existing test free of file handles.
 * Tests that need the production FILE layout -- the diagnostics outbox derives its own telemetry
 * database from the app database's path -- pass [appDatabaseIsFile] `true`: the app database then
 * lives at the root of the isolated directory, and [telemetryDatabaseFile] is its sibling, exactly
 * the relationship production has inside `filesDir/SQLite/`.
 */
internal class SyncEngineTestDatabase(private val appDatabaseIsFile: Boolean = false) : AutoCloseable {
  private val temporaryDirectory = File(
    System.getProperty("java.io.tmpdir") ?: error("java.io.tmpdir is not configured"),
  )
  val journalDirectory: File = File(temporaryDirectory, "sync-engine-test-${UUID.randomUUID()}")
    .apply { check(mkdirs()) { "Could not create isolated journal directory: $this" } }
  private val journalContext = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
    override fun getFilesDir(): File = journalDirectory
  }

  /** The app database's file for the file-backed mode; its parent is the telemetry sibling's. */
  private val appDatabaseFile = File(journalDirectory, APP_DATABASE_NAME)

  val appDatabase: SQLiteDatabase = if (appDatabaseIsFile) {
    SQLiteDatabase.openOrCreateDatabase(appDatabaseFile, null).apply {
      compileStatement("PRAGMA busy_timeout = $APP_DB_BUSY_TIMEOUT_MS").execute()
    }
  } else {
    SQLiteDatabase.create(null)
  }
  val journal: SyncEngineJournal = SyncEngineJournal(journalContext)

  /**
   * The diagnostics outbox's database -- the JS-owned `autoreas-telemetry.db` the native drain
   * only reads and writes. Resolved through the SAME production derivation the courier uses, so a
   * path change in the engine cannot silently pass the tests.
   */
  val telemetryDatabaseFile: File get() = resolveTelemetryDatabaseFile(appDatabaseFile)

  /** The test's own telemetry handle, opened lazily by [openTelemetryOutbox]. */
  private var telemetryHandle: SQLiteDatabase? = null

  init {
    appDatabase.execSQL(
      "CREATE TABLE sync_cycle_lock (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, " +
        "expires_at INTEGER NOT NULL, fence TEXT NOT NULL)",
    )
    appDatabase.execSQL(
      "CREATE TABLE bridge_config (id INTEGER PRIMARY KEY, device_id TEXT, ip TEXT, port TEXT, " +
        "token TEXT, last_changelog_id INTEGER, is_sync_telemetry_enabled INTEGER)",
    )
    appDatabase.execSQL(
      "CREATE TABLE animes (_id TEXT PRIMARY KEY, bridge_modified_at INTEGER)",
    )
    appDatabase.execSQL(
      "CREATE TABLE operation_log (id INTEGER PRIMARY KEY, anime_id TEXT, operation TEXT, " +
        "payload TEXT, status TEXT NOT NULL, created_at INTEGER, " +
        "conflict_attempt_count INTEGER NOT NULL DEFAULT 0)",
    )
  }

  fun addOperation(id: Long, status: String) {
    appDatabase.execSQL(
      "INSERT INTO operation_log (id, status) VALUES (?, ?)",
      arrayOf<Any>(id, status),
    )
  }

  fun operationStatuses(): List<Pair<Long, String>> = appDatabase.rawQuery(
    "SELECT id, status FROM operation_log ORDER BY id",
    null,
  ).use { cursor ->
    buildList {
      while (cursor.moveToNext()) add(cursor.getLong(0) to cursor.getString(1))
    }
  }

  /**
   * Opens (creating on first use) the telemetry database and provisions the two tables the JS
   * `syncDiagnosticsOutboxStore` owns -- `sync_diagnostics_outbox` and its singleton not-before
   * row. The engine never runs this DDL (it must not invent a schema it does not own), so the
   * fixture reproduces it here rather than calling the code under test to set itself up. The
   * JS-owned eviction trigger is deliberately not created: no test here seeds near the 100-row cap.
   */
  fun openTelemetryOutbox(): SQLiteDatabase {
    telemetryHandle?.let { return it }
    val opened = SQLiteDatabase.openOrCreateDatabase(telemetryDatabaseFile, null)
    opened.compileStatement("PRAGMA busy_timeout = $SYNC_DIAGNOSTICS_OUTBOX_BUSY_TIMEOUT_MS").execute()
    opened.execSQL(
      "CREATE TABLE IF NOT EXISTS sync_diagnostics_outbox (" +
        "cycle_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL)",
    )
    opened.execSQL(
      "CREATE TABLE IF NOT EXISTS sync_diagnostics_outbox_state (" +
        "id INTEGER PRIMARY KEY CHECK (id = 1), not_before INTEGER NOT NULL)",
    )
    telemetryHandle = opened
    return opened
  }

  /** Seeds one stored diagnostics envelope, exactly as the JS capture path writes it. */
  fun seedTelemetryEntry(cycleId: String, payload: String, createdAt: Long) {
    openTelemetryOutbox().execSQL(
      "INSERT INTO sync_diagnostics_outbox (cycle_id, payload, created_at) VALUES (?, ?, ?)",
      arrayOf<Any>(cycleId, payload, createdAt),
    )
  }

  /** Every stored envelope, oldest-first, as `cycle_id to payload` pairs. */
  fun telemetryEntries(): List<Pair<String, String>> = readTelemetry(
    "SELECT cycle_id, payload FROM sync_diagnostics_outbox ORDER BY created_at ASC, rowid ASC",
  ) { cursor -> cursor.getString(0) to cursor.getString(1) }

  /** The singleton not-before gate, or `null` when no `Retry-After` has ever been persisted. */
  fun telemetryNotBefore(): Long? = readTelemetry(
    "SELECT not_before FROM sync_diagnostics_outbox_state WHERE id = 1",
  ) { cursor -> cursor.getLong(0) }.firstOrNull()

  /** Every table name in the telemetry database, so a test can prove the engine created none. */
  fun telemetryTables(): List<String> = readTelemetry(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ) { cursor -> cursor.getString(0) }

  /**
   * Reads the telemetry database from a FRESH connection, so a value written by the engine's own
   * connection is proven to be on disk rather than in a shared handle's cache.
   */
  private fun <T> readTelemetry(sql: String, map: (Cursor) -> T): List<T> {
    if (!telemetryDatabaseFile.exists()) return emptyList()
    return SQLiteDatabase.openDatabase(
      telemetryDatabaseFile.path,
      null,
      SQLiteDatabase.OPEN_READONLY,
    ).use { database ->
      database.rawQuery(sql, null).use { cursor ->
        buildList {
          while (cursor.moveToNext()) add(map(cursor))
        }
      }
    }
  }

  override fun close() {
    try {
      telemetryHandle?.close()
    } finally {
      telemetryHandle = null
      try {
        journal.close()
      } finally {
        try {
          appDatabase.close()
        } finally {
          val fixturePath = journalDirectory.canonicalFile
          check(
            fixturePath.parentFile == temporaryDirectory.canonicalFile &&
              fixturePath.name == journalDirectory.name,
          ) {
            "Refusing to clean journal directory outside temporary directory: $fixturePath"
          }
          val expectedFiles = setOf(
            "sync-journal.db",
            "sync-journal.db-journal",
            "sync-journal.db-wal",
            "sync-journal.db-shm",
            APP_DATABASE_NAME,
            "$APP_DATABASE_NAME-journal",
            "$APP_DATABASE_NAME-wal",
            "$APP_DATABASE_NAME-shm",
            SYNC_DIAGNOSTICS_TELEMETRY_DATABASE_NAME,
            "$SYNC_DIAGNOSTICS_TELEMETRY_DATABASE_NAME-journal",
            "$SYNC_DIAGNOSTICS_TELEMETRY_DATABASE_NAME-wal",
            "$SYNC_DIAGNOSTICS_TELEMETRY_DATABASE_NAME-shm",
          )
          val fixtureFiles = journalDirectory.listFiles()
            ?: error("Could not inspect isolated journal directory: $journalDirectory")
          val unexpectedEntries = fixtureFiles.filter { file ->
            file.name !in expectedFiles ||
              file.canonicalFile.parentFile != fixturePath ||
              file.canonicalFile.name != file.name ||
              !file.isFile
          }
          check(unexpectedEntries.isEmpty()) {
            "Refusing to clean unexpected journal entries: ${unexpectedEntries.joinToString()}"
          }
          fixtureFiles.forEach { file ->
            check(file.delete()) { "Could not clean isolated journal file: $file" }
          }
          check(journalDirectory.delete()) {
            "Could not clean isolated journal directory: $journalDirectory"
          }
        }
      }
    }
  }
}
