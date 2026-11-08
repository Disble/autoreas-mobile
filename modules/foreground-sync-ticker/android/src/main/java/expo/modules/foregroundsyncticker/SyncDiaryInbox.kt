package expo.modules.foregroundsyncticker

import android.database.sqlite.SQLiteDatabase
import java.io.File
import org.json.JSONObject

/** The inbox file the main process writes instead of `autoreas-telemetry.db`, beside it. */
const val SYNC_DIARY_INBOX_DATABASE_NAME = "sync-diary-inbox.db"

/** Most records the inbox holds; a record past it is only counted in its hour's `dropped_count`. */
const val SYNC_DIARY_INBOX_MAX_ROWS = 500

/** Inbox mark held while the foreground service's last known state is `refused` (S4, B1). */
internal const val SYNC_DIARY_SERVICE_REFUSED_MARK = "service_refused"

private const val ENTRIES_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS sync_diary_inbox (" +
    "seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, now_ms INTEGER NOT NULL, args TEXT NOT NULL)"

private const val DROPS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS sync_diary_inbox_drops (" +
    "hour_start_ms INTEGER PRIMARY KEY, dropped_count INTEGER NOT NULL)"

private const val MARKS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS sync_diary_inbox_marks (mark_key TEXT PRIMARY KEY)"

/**
 * One record the main process queued: the diary call ([kind] and [args]) and when it was made.
 * [args] stays raw JSON here so one unreadable row cannot fail the whole drain.
 */
internal data class SyncDiaryInboxEntry(val seq: Long, val kind: String, val nowMs: Long, val args: String)

/**
 * The main process's half of the diary (verifier blocker B2). JS keeps an expo-sqlite connection
 * to `autoreas-telemetry.db` open in the main process, and a framework SQLite connection closing
 * there would drop that process's POSIX locks on the file, expo-sqlite's WAL lock included. So the
 * main process never opens the telemetry file: it queues each diary call here, in a file only the
 * framework SQLite ever opens, and the `:sync` process -- the only native writer of the telemetry
 * file -- replays the queue there, in order and with each call's own time, before its own work.
 *
 * The inbox is bounded by [maxRows]; a call past it is counted per hour and added to that hour's
 * `dropped_count` when `:sync` drains it. It also holds the marks a main-process call must check at
 * insert time, such as [SYNC_DIARY_SERVICE_REFUSED_MARK].
 */
internal class SyncDiaryInbox(val file: File, private val maxRows: Int) {

  /**
   * Runs [block] in one transaction on a fresh framework connection to the inbox, creating the
   * file and its tables when missing. Throws what SQLite throws; the diary catches it.
   */
  fun <T> inTransaction(block: (SQLiteDatabase) -> T): T =
    SQLiteDatabase.openDatabase(
      file.path,
      null,
      SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY,
    ).use { database ->
      database.compileStatement("PRAGMA busy_timeout = $SYNC_DIARY_BUSY_TIMEOUT_MS").use { it.execute() }
      database.execSQL(ENTRIES_TABLE_SQL)
      database.execSQL(DROPS_TABLE_SQL)
      database.execSQL(MARKS_TABLE_SQL)
      database.beginTransaction()
      try {
        val result = block(database)
        database.setTransactionSuccessful()
        result
      } finally {
        database.endTransaction()
      }
    }

  /**
   * Queues one call, or counts it as dropped in the hour of [nowMs] when the inbox already holds
   * [maxRows] calls. Answers whether it was queued.
   */
  fun queue(database: SQLiteDatabase, kind: String, nowMs: Long, args: JSONObject): Boolean {
    val queued = database.compileStatement("SELECT COUNT(*) FROM sync_diary_inbox")
      .use { statement -> statement.simpleQueryForLong() }
    if (queued >= maxRows) {
      database.execSQL(
        "INSERT INTO sync_diary_inbox_drops (hour_start_ms, dropped_count) VALUES (?, 1) " +
          "ON CONFLICT(hour_start_ms) DO UPDATE SET dropped_count = dropped_count + 1",
        arrayOf<Any>(syncDiaryHourStart(nowMs)),
      )
      return false
    }
    database.execSQL(
      "INSERT INTO sync_diary_inbox (kind, now_ms, args) VALUES (?, ?, ?)",
      arrayOf<Any>(kind, nowMs, args.toString()),
    )
    return true
  }

  /** Sets [key]; answers `false` when it was already set, so the caller has nothing new to say. */
  fun claimMark(database: SQLiteDatabase, key: String): Boolean =
    database.compileStatement("INSERT OR IGNORE INTO sync_diary_inbox_marks (mark_key) VALUES (?)")
      .use { statement ->
        statement.bindString(1, key)
        statement.executeUpdateDelete() == 1
      }

  /** Clears [key], so the next [claimMark] succeeds again. */
  fun clearMark(database: SQLiteDatabase, key: String) {
    database.execSQL("DELETE FROM sync_diary_inbox_marks WHERE mark_key = ?", arrayOf<Any>(key))
  }

  /** Every queued call, oldest first. */
  fun entries(database: SQLiteDatabase): List<SyncDiaryInboxEntry> =
    database.rawQuery("SELECT seq, kind, now_ms, args FROM sync_diary_inbox ORDER BY seq", null).use { cursor ->
      buildList {
        while (cursor.moveToNext()) {
          add(SyncDiaryInboxEntry(cursor.getLong(0), cursor.getString(1), cursor.getLong(2), cursor.getString(3)))
        }
      }
    }

  /** Every hour's count of calls the cap turned away, as (hour start, count). */
  fun drops(database: SQLiteDatabase): List<Pair<Long, Long>> =
    database.rawQuery("SELECT hour_start_ms, dropped_count FROM sync_diary_inbox_drops ORDER BY 1", null)
      .use { cursor -> buildList { while (cursor.moveToNext()) add(cursor.getLong(0) to cursor.getLong(1)) } }

  /** Deletes the calls up to [throughSeq] and every drop count: what one drain moved. */
  fun clear(database: SQLiteDatabase, throughSeq: Long) {
    database.execSQL("DELETE FROM sync_diary_inbox WHERE seq <= ?", arrayOf<Any>(throughSeq))
    database.execSQL("DELETE FROM sync_diary_inbox_drops")
  }
}
