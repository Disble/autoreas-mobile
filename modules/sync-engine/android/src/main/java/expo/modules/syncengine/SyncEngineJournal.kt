package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.util.Log
import android.content.Context
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService

private const val JOURNAL_FILE_NAME = "sync-journal.db"
private const val JOURNAL_LOG_TAG = "SyncEngineJournal"
private const val JOURNAL_BUSY_TIMEOUT_MS = 250L
private const val JOURNAL_MAX_ROWS = 500L

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

private const val PRUNE_BEYOND_CAPACITY_SQL =
  "DELETE FROM journal WHERE id NOT IN " +
    "(SELECT id FROM journal ORDER BY id DESC LIMIT $JOURNAL_MAX_ROWS)"

/**
 * The engine's own writer for `sync-journal.db`, on its OWN connection — the same out-of-door
 * file the `SyncJournal` module (T2) created. Two writers share one file today:
 * `modules/sync-journal` (the JS seam) and this engine. **The schema is owned by
 * `modules/sync-journal`; both writers must keep it byte-identical — file name, table shape,
 * 250 ms busy budget and the 500-row cap — and ODD task T5 unifies them behind a single
 * writer.** Until then, every change to the journal shape must land in both modules at once.
 *
 * Writes are intent-before-effect by contract: the caller appends the row naming a transition
 * BEFORE performing the effect it names, so an attempt parked inside a native call reports the
 * state it parked in (docs/mobile-sync-architecture.md 6.2). Appends are bounded by the 250 ms
 * busy budget and never throw: the journal is an instrument, not a participant, and a failed
 * append degrades to `false` — the attempt continues.
 *
 * The append path is synchronized because TWO threads use this object: the work executor and
 * the watchdog thread (which writes the `abandoned` row itself, since the worker may be parked
 * inside a native call and unable to report).
 */
class SyncEngineJournal(context: Context) {
  private val file: File = File(context.filesDir, JOURNAL_FILE_NAME)

  // A dedicated single-thread executor keeps the WORKER's appends off both the work thread and
  // the watchdog thread's own budget; the watchdog's abandon append runs through the same
  // synchronized append below, so the two writers of this file serialize on the monitor.
  private val executor: ExecutorService = Executors.newSingleThreadExecutor()
  private var db: SQLiteDatabase? = null

  /**
   * Appends one transition row and prunes beyond capacity, reporting success as a plain
   * boolean. Never throws; both outcomes are logged because a non-debuggable build cannot pull
   * the journal file for inspection (same observability rule as the `SyncJournal` module).
   */
  @Synchronized
  fun append(
    cycleId: String,
    fromState: String?,
    toState: String,
    reason: String?,
    atMs: Long,
  ): Boolean {
    return try {
      val database = openJournal()
      if (database == null) {
        Log.w(JOURNAL_LOG_TAG, "append dropped for cycle=$cycleId: journal unreadable")
        return false
      }

      database.compileStatement(INSERT_TRANSITION_SQL).apply {
        bindString(1, cycleId)
        if (fromState != null) bindString(2, fromState) else bindNull(2)
        bindString(3, toState)
        if (reason != null) bindString(4, reason) else bindNull(4)
        bindLong(5, atMs)
        executeInsert()
      }
      pruneBeyondCapacity(database)
      Log.i(JOURNAL_LOG_TAG, "appended cycle=$cycleId from=$fromState to=$toState reason=$reason")
      true
    } catch (error: Throwable) {
      Log.w(JOURNAL_LOG_TAG, "append failed for cycle=$cycleId", error)
      false
    }
  }

  /** Closes the journal connection and stops its executor (called from `OnDestroy`). */
  fun close() {
    executor.shutdown()
    try {
      db?.close()
    } catch (error: Throwable) {
      // The process is tearing the module down; a failed close has nothing left to report to.
    }
    db = null
  }

  /** Opens the journal file once, lazily; mirrors `SyncJournalModule.openJournal`. */
  private fun openJournal(): SQLiteDatabase? {
    db?.let { return it }
    return try {
      val database = SQLiteDatabase.openOrCreateDatabase(file, null)
      database.compileStatement("PRAGMA busy_timeout = $JOURNAL_BUSY_TIMEOUT_MS").execute()
      database.execSQL(CREATE_JOURNAL_SQL)
      db = database
      Log.i(JOURNAL_LOG_TAG, "journal opened at $file")
      database
    } catch (error: Throwable) {
      Log.w(JOURNAL_LOG_TAG, "journal open failed", error)
      null
    }
  }

  /** Bounded growth: after every insert, only the newest [JOURNAL_MAX_ROWS] rows survive. */
  private fun pruneBeyondCapacity(database: SQLiteDatabase) {
    try {
      database.execSQL(PRUNE_BEYOND_CAPACITY_SQL)
    } catch (error: Throwable) {
      // Pruning is housekeeping, not reporting: a failed prune must not fail the insert.
    }
  }
}
