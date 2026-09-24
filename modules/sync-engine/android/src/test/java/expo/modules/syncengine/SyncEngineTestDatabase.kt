package expo.modules.syncengine

import android.content.ContextWrapper
import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.util.UUID
import org.robolectric.RuntimeEnvironment

/** Small isolated native-SQLite fixture for tests that exercise engine database and journal effects. */
internal class SyncEngineTestDatabase : AutoCloseable {
  private val temporaryDirectory = File(
    System.getProperty("java.io.tmpdir") ?: error("java.io.tmpdir is not configured"),
  )
  val journalDirectory: File = File(temporaryDirectory, "sync-engine-test-${UUID.randomUUID()}")
    .apply { check(mkdirs()) { "Could not create isolated journal directory: $this" } }
  private val journalContext = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
    override fun getFilesDir(): File = journalDirectory
  }

  val appDatabase: SQLiteDatabase = SQLiteDatabase.create(null)
  val journal: SyncEngineJournal = SyncEngineJournal(journalContext)

  init {
    appDatabase.execSQL(
      "CREATE TABLE sync_cycle_lock (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, " +
        "expires_at INTEGER NOT NULL, fence TEXT NOT NULL)",
    )
    appDatabase.execSQL(
      "CREATE TABLE bridge_config (id INTEGER PRIMARY KEY, device_id TEXT, ip TEXT, port TEXT, " +
        "token TEXT, last_changelog_id INTEGER)",
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

  override fun close() {
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
        val expectedJournalFiles = setOf(
          "sync-journal.db",
          "sync-journal.db-journal",
          "sync-journal.db-wal",
          "sync-journal.db-shm",
        )
        val journalFiles = journalDirectory.listFiles()
          ?: error("Could not inspect isolated journal directory: $journalDirectory")
        val unexpectedEntries = journalFiles.filter { file ->
          file.name !in expectedJournalFiles ||
            file.canonicalFile.parentFile != fixturePath ||
            file.canonicalFile.name != file.name ||
            !file.isFile
        }
        check(unexpectedEntries.isEmpty()) {
          "Refusing to clean unexpected journal entries: ${unexpectedEntries.joinToString()}"
        }
        journalFiles.forEach { file ->
          check(file.delete()) { "Could not clean isolated journal file: $file" }
        }
        check(journalDirectory.delete()) {
          "Could not clean isolated journal directory: $journalDirectory"
        }
      }
    }
  }
}
