package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.util.Log
import android.content.Context
import java.io.File

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

private const val READ_LATEST_TRANSITION_SQL =
  "SELECT cycle_id, to_state, at_ms FROM journal WHERE cycle_id != ? ORDER BY id DESC LIMIT 1"

/**
 * One journal transition row read back by the recovery sweep: the cycle that wrote it, the
 * state it transitioned INTO (a row's `to_state` IS the attempt's current state), and when it
 * was appended.
 */
data class JournalTransition(
  val cycleId: String,
  val toState: String,
  val atMs: Long,
)

/**
 * The only writer of `sync-journal.db`, on its OWN connection: the journal must not live behind the
 * app database's write door it reports on (docs/mobile-sync-architecture.md 6.3). It owns the file
 * name, the table shape, the 250 ms busy budget and the 500-row cap.
 *
 * Writes are intent-before-effect by contract: the caller appends the row naming a transition
 * BEFORE performing the effect it names, so an attempt parked inside a native call reports the
 * state it parked in (docs/mobile-sync-architecture.md 6.2). Appends are bounded by the 250 ms
 * busy budget and never throw: the journal is an instrument, not a participant, and a failed
 * append degrades to `false` — the attempt continues.
 *
 * The append path is synchronized because TWO threads use this object: the attempt's work thread
 * and the watchdog thread (which writes the `abandoned` row itself, since the worker may be parked
 * inside a native call and unable to report).
 */
class SyncEngineJournal(context: Context) {
  private val file: File = File(context.filesDir, JOURNAL_FILE_NAME)

  private var db: SQLiteDatabase? = null

  /**
   * Appends one transition row and prunes beyond capacity, reporting success as a plain
   * boolean. Never throws; both outcomes are logged because a non-debuggable build cannot pull
   * the journal file for inspection.
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

  /**
   * Reads the newest transition row NOT belonging to [currentCycleId] — i.e. the previous
   * attempt's last recorded state — or `null` when there is none or the journal is unreadable.
   * The exclusion is what makes the recovery sweep meaningful: by the time the sweep runs, the
   * current attempt has already appended its own `checked` row, so the absolute newest row is
   * always the reader's own and must not be judged as a stale orphan.
   */
  fun readLatestTransition(currentCycleId: String): JournalTransition? {
    return try {
      val database = openJournal() ?: return null
      database.rawQuery(READ_LATEST_TRANSITION_SQL, arrayOf(currentCycleId)).use { cursor ->
        if (!cursor.moveToFirst()) {
          null
        } else {
          JournalTransition(
            cycleId = cursor.getString(0),
            toState = cursor.getString(1),
            atMs = cursor.getLong(2),
          )
        }
      }
    } catch (error: Throwable) {
      Log.w(JOURNAL_LOG_TAG, "latest transition read failed", error)
      null
    }
  }

  /** Closes the journal connection (called from `OnDestroy`). */
  fun close() {
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
