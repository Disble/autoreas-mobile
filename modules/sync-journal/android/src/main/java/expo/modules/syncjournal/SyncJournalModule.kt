package expo.modules.syncjournal

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

private const val JOURNAL_FILE_NAME = "sync-journal.db"
private const val BUSY_TIMEOUT_MS = 250L
private const val MAX_ROWS = 500L

private const val CREATE_JOURNAL_SQL =
  "CREATE TABLE IF NOT EXISTS journal (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
    "cycle_id TEXT NOT NULL, " +
    "from_state TEXT, " +
    "to_state TEXT NOT NULL, " +
    "reason TEXT, " +
    "at_ms INTEGER NOT NULL)"

private const val INSERT_TRANSITION_SQL =
  "INSERT INTO journal (cycle_id, from_state, to_state, reason, at_ms) VALUES (?, ?, ?, ?, ?)"

private const val SELECT_COLUMNS = "cycle_id, from_state, to_state, reason, at_ms"

private const val PRUNE_BEYOND_CAPACITY_SQL =
  "DELETE FROM journal WHERE id NOT IN " +
    "(SELECT id FROM journal ORDER BY id DESC LIMIT $MAX_ROWS)"

/**
 * Append-only sync journal in its OWN SQLite file, on its OWN connection.
 *
 * Why a separate file at all: the machine's journal must not live behind the door it reports on
 * (docs/mobile-sync-architecture.md 6.3). If the journal shared the app database's write door,
 * the state of an attempt would become unreadable exactly when it is needed, and the recovery
 * path would inherit the failure it is recovering from. This module therefore NEVER opens the
 * app's `autoreas.db`: `sync-journal.db` gets a single-thread executor, its own connection, and
 * writes that cannot queue behind the store it reports on -- the pattern already proven by
 * `autoreas-telemetry.db` (0 failed writes while the main store was parked).
 *
 * Why the write budget is bounded: `PRAGMA busy_timeout = 250` bounds every statement's wait so
 * a stuck lock on this file degrades to a `false` answer instead of an unbounded hang, and
 * everything that can fail resolves into a JS-facing default (`false` / `null` / empty / `0`)
 * rather than a rejected promise: a journal that cannot report must never take the cycle down
 * with it.
 */
class SyncJournalModule : Module() {
  private val journalExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private var journalDb: SQLiteDatabase? = null

  /**
   * Opens `sync-journal.db` once, lazily, on the module's own executor thread. The file has no
   * migrations and no other tables: the schema is created idempotently and never altered.
   */
  private fun openJournal(): SQLiteDatabase? {
    journalDb?.let { return it }

    val context = appContext.reactContext ?: return null

    return try {
      val db = SQLiteDatabase.openOrCreateDatabase(File(context.filesDir, JOURNAL_FILE_NAME), null)
      // Bounded write budget: no statement waits longer than this for this file's lock.
      db.compileStatement("PRAGMA busy_timeout = $BUSY_TIMEOUT_MS").execute()
      db.execSQL(CREATE_JOURNAL_SQL)
      journalDb = db
      db
    } catch (error: Throwable) {
      null
    }
  }

  /** Appends one transition, prunes beyond capacity, and reports success as a plain boolean. */
  private fun insertTransition(
    cycleId: String,
    fromState: String?,
    toState: String,
    reason: String?,
    atMs: Long,
  ): Boolean {
    val db = openJournal() ?: return false

    return try {
      db.compileStatement(INSERT_TRANSITION_SQL).apply {
        bindString(1, cycleId)
        if (fromState != null) bindString(2, fromState) else bindNull(2)
        bindString(3, toState)
        if (reason != null) bindString(4, reason) else bindNull(4)
        bindLong(5, atMs)
        executeInsert()
      }
      pruneBeyondCapacity(db)
      true
    } catch (error: Throwable) {
      false
    }
  }

  /** Bounded growth: after every insert, only the newest [MAX_ROWS] rows survive. */
  private fun pruneBeyondCapacity(db: SQLiteDatabase) {
    try {
      db.execSQL(PRUNE_BEYOND_CAPACITY_SQL)
    } catch (error: Throwable) {
      // Pruning is housekeeping, not reporting: a failed prune must not fail the insert.
    }
  }

  private fun readLatestTransitionSync(): Map<String, Any?>? {
    val db = openJournal() ?: return null

    return try {
      db.rawQuery("SELECT $SELECT_COLUMNS FROM journal ORDER BY id DESC LIMIT 1", null).use { cursor ->
        if (cursor.moveToFirst()) rowToMap(cursor) else null
      }
    } catch (error: Throwable) {
      null
    }
  }

  private fun readTransitionsSync(cycleId: String, limit: Int): List<Map<String, Any?>> {
    val db = openJournal() ?: return emptyList()

    return try {
      db.rawQuery(
        "SELECT $SELECT_COLUMNS FROM journal WHERE cycle_id = ? ORDER BY id DESC LIMIT ?",
        arrayOf(cycleId, limit.toString()),
      ).use { cursor ->
        val rows = mutableListOf<Map<String, Any?>>()
        while (cursor.moveToNext()) {
          rows.add(rowToMap(cursor))
        }
        rows
      }
    } catch (error: Throwable) {
      emptyList()
    }
  }

  private fun countTransitionsSync(): Int {
    val db = openJournal() ?: return 0

    return try {
      db.rawQuery("SELECT COUNT(*) FROM journal", null).use { cursor ->
        if (cursor.moveToFirst()) cursor.getInt(0) else 0
      }
    } catch (error: Throwable) {
      0
    }
  }

  private fun rowToMap(cursor: Cursor): Map<String, Any?> = mapOf(
    "cycleId" to cursor.getString(0),
    "fromState" to if (cursor.isNull(1)) null else cursor.getString(1),
    "toState" to cursor.getString(2),
    "reason" to if (cursor.isNull(3)) null else cursor.getString(3),
    "atMs" to cursor.getLong(4).toDouble(),
  )

  override fun definition() = ModuleDefinition {
    Name("SyncJournal")

    AsyncFunction("recordTransition") { cycleId: String, fromState: String?, toState: String, reason: String?, atMs: Double, promise: Promise ->
      journalExecutor.execute {
        try {
          promise.resolve(insertTransition(cycleId, fromState, toState, reason, atMs.toLong()))
        } catch (error: Throwable) {
          // Never throw into JS: a journal failure degrades to `false`.
          promise.resolve(false)
        }
      }
    }

    AsyncFunction("readLatestTransition") { promise: Promise ->
      journalExecutor.execute {
        try {
          promise.resolve(readLatestTransitionSync())
        } catch (error: Throwable) {
          promise.resolve(null)
        }
      }
    }

    AsyncFunction("readTransitions") { cycleId: String, limit: Int, promise: Promise ->
      journalExecutor.execute {
        try {
          promise.resolve(readTransitionsSync(cycleId, limit))
        } catch (error: Throwable) {
          promise.resolve(emptyList())
        }
      }
    }

    AsyncFunction("countTransitions") { promise: Promise ->
      journalExecutor.execute {
        try {
          promise.resolve(countTransitionsSync())
        } catch (error: Throwable) {
          promise.resolve(0)
        }
      }
    }

    OnDestroy {
      journalExecutor.shutdown()
      try {
        journalDb?.close()
      } catch (error: Throwable) {
        // The process is tearing the module down; a failed close has nothing left to report to.
      }
      journalDb = null
    }
  }
}
