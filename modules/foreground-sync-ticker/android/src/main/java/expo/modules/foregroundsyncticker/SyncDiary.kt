package expo.modules.foregroundsyncticker

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.os.Build
import android.util.Log
import java.io.File
import java.util.UUID

/** What became of one report handed to the diary. */
enum class SyncDiaryEnqueueResult {
  /** Stored in the outbox; a drain delivers it. */
  INSERTED,

  /** The outbox already holds this observation id: the first write wins. */
  DUPLICATE,

  /** Skipped by the 60-row reserve or the daily limit, and counted in the next `dropped_count`. */
  DROPPED,

  /** Off the agreed vocabulary; nothing stored. */
  REJECTED,

  /** No telemetry database to write (file missing, outbox not provisioned, or a SQLite failure). */
  UNAVAILABLE,

  /** The hour's quota for this report's limit key is spent; nothing stored and nothing dropped. */
  LIMITED,

  /** Nothing changed since the last record (the same boot), so there was nothing to report. */
  UNCHANGED,
}

/** Log tag for every diary failure; a failure is logged and swallowed, never thrown. */
private const val TAG = "SyncDiary"

private const val STATE_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS sync_diary_state (" +
    "id INTEGER PRIMARY KEY CHECK (id = 1), install_id TEXT NOT NULL, " +
    "day_start_ms INTEGER NOT NULL, day_count INTEGER NOT NULL)"

private const val COUNTS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS sync_diary_counts (" +
    "hour_start_ms INTEGER NOT NULL, trigger_source TEXT NOT NULL, outcome TEXT NOT NULL, " +
    "count INTEGER NOT NULL, max_duration_ms INTEGER, " +
    "PRIMARY KEY (hour_start_ms, trigger_source, outcome))"

private const val DEATHS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS sync_diary_deaths (" +
    "hour_start_ms INTEGER NOT NULL, process_name TEXT NOT NULL, reason TEXT NOT NULL, " +
    "count INTEGER NOT NULL, PRIMARY KEY (hour_start_ms, process_name, reason))"

private const val DROPS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS sync_diary_drops (" +
    "hour_start_ms INTEGER PRIMARY KEY, dropped_count INTEGER NOT NULL)"

private const val MARKS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS sync_diary_marks (mark_key TEXT PRIMARY KEY, mark_value INTEGER NOT NULL)"

private const val LIMITS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS sync_diary_limits (" +
    "hour_start_ms INTEGER NOT NULL, limit_key TEXT NOT NULL, count INTEGER NOT NULL, " +
    "PRIMARY KEY (hour_start_ms, limit_key))"

/** Mark holding the boot time last seen by either process. */
private const val BOOT_MARK = "boot_time_ms"

/** Prefix of the mark holding the newest exit timestamp already read for one process. */
private const val EXIT_MARK_PREFIX = "exit_seen_ms:"

private const val UPSERT_COUNT_SQL =
  "INSERT INTO sync_diary_counts (hour_start_ms, trigger_source, outcome, count, max_duration_ms) " +
    "VALUES (?, ?, ?, 1, ?) ON CONFLICT(hour_start_ms, trigger_source, outcome) DO UPDATE SET " +
    "count = count + 1, max_duration_ms = MAX(max_duration_ms, excluded.max_duration_ms)"

private const val UPSERT_DEATH_SQL =
  "INSERT INTO sync_diary_deaths (hour_start_ms, process_name, reason, count) VALUES (?, ?, ?, 1) " +
    "ON CONFLICT(hour_start_ms, process_name, reason) DO UPDATE SET count = count + 1"

private const val UPSERT_DROP_SQL =
  "INSERT INTO sync_diary_drops (hour_start_ms, dropped_count) VALUES (?, 1) " +
    "ON CONFLICT(hour_start_ms) DO UPDATE SET dropped_count = dropped_count + 1"

/** The JS-owned outbox insert, byte-identical to `SYNC_DIAGNOSTICS_OUTBOX_INSERT_SQL`. */
private const val OUTBOX_INSERT_SQL =
  "INSERT INTO sync_diagnostics_outbox (cycle_id, payload, created_at) " +
    "VALUES (?, ?, ?) ON CONFLICT(cycle_id) DO NOTHING"

private const val CLOSED_HOURS_SQL =
  "SELECT hour_start_ms FROM sync_diary_counts WHERE hour_start_ms < CAST(?1 AS INTEGER) " +
    "UNION SELECT hour_start_ms FROM sync_diary_deaths WHERE hour_start_ms < CAST(?1 AS INTEGER) " +
    "UNION SELECT hour_start_ms FROM sync_diary_drops " +
    "WHERE hour_start_ms < CAST(?1 AS INTEGER) AND dropped_count > 0 " +
    "ORDER BY 1"

/**
 * The tablet's durable sync diary (odd/tasks/mobile-report-kinds.md S3-S6): hourly counts of sync
 * attempts and process deaths, and `runtime_transition` reports, written into the diagnostics
 * outbox of `autoreas-telemetry.db` so the existing drains deliver them.
 *
 * It lives in this module because `sync-engine` depends on it and never the reverse, so both
 * engines and the JS side reach one writer only here. It owns the DDL of its own `sync_diary_*`
 * tables and never the outbox's: the JS store creates `sync_diagnostics_outbox` and its 100-row
 * trigger. It never creates the database file either -- a missing file makes every call a no-op,
 * exactly as `SyncEngineDiagnosticsOutbox` behaves.
 *
 * The main and `:sync` processes write concurrently, so every call runs in ONE transaction on its
 * own short-lived connection (busy timeout [SYNC_DIARY_BUSY_TIMEOUT_MS]). No call ever throws: a
 * diary failure is logged and answered with a neutral result, because it must never hurt sync.
 *
 * There is no timer (S6): every record call first closes the hours that ended before it, emitting
 * one `hourly_summary` for each and deleting its rows.
 */
class SyncDiary(
  private val telemetryFile: File,
  appVersion: String?,
  private val newId: () -> String = { UUID.randomUUID().toString() },
) {
  private val appVersion = sanitizeSyncDiaryAppVersion(appVersion)

  /**
   * Stores one new-kind report under [observationId] (its outbox `cycle_id`), unless the outbox
   * already holds [SYNC_DIARY_OUTBOX_RESERVE_ROWS] rows or [SYNC_DIARY_DAILY_REPORT_LIMIT] new-kind
   * rows were stored this UTC day; a skipped report is counted in the hour of [nowMs] and named by
   * that hour's summary. A repeated id keeps its first payload and costs no daily slot.
   */
  fun enqueueReport(observationId: String, payloadJson: String, nowMs: Long): SyncDiaryEnqueueResult =
    inTransaction("enqueueReport", SyncDiaryEnqueueResult.UNAVAILABLE) { database ->
      enqueue(database, observationId, payloadJson, nowMs)
    }

  /**
   * Counts one sync attempt in the hour of [nowMs] and keeps the pair's longest duration. Answers
   * `false` when the attempt was not counted: an off-list [triggerSource] or [outcome], or no
   * database to write.
   */
  fun recordAttempt(triggerSource: String, outcome: String, durationMs: Long, nowMs: Long): Boolean {
    if (triggerSource !in SYNC_DIARY_TRIGGER_SOURCES || outcome !in SYNC_DIARY_OUTCOMES) {
      Log.w(TAG, "Rejected attempt $triggerSource/$outcome")
      return false
    }
    return inTransaction("recordAttempt", false) { database ->
      closeHours(database, nowMs)
      database.execSQL(
        UPSERT_COUNT_SQL,
        arrayOf<Any>(
          syncDiaryHourStart(nowMs),
          triggerSource,
          outcome,
          // Stored as measured; the summary clamps it to the Bridge's bounds.
          durationMs,
        ),
      )
      true
    }
  }

  /**
   * Counts one process death in the hour it is read ([nowMs]), not the hour it happened (S3).
   * Answers `false` for an unknown [processName], a [reason] off `^[a-z0-9_]{1,40}$`, or no
   * database to write.
   */
  fun recordProcessDeath(processName: String, reason: String, nowMs: Long): Boolean {
    if (processName !in SYNC_DIARY_PROCESS_NAMES || !isSyncDiaryReason(reason)) {
      Log.w(TAG, "Rejected process death $processName/$reason")
      return false
    }
    return inTransaction("recordProcessDeath", false) { database ->
      closeHours(database, nowMs)
      database.execSQL(UPSERT_DEATH_SQL, arrayOf<Any>(syncDiaryHourStart(nowMs), processName, reason))
      true
    }
  }

  /**
   * Reports one real state change as a `runtime_transition` (S4), under a fresh observation id.
   * Only the 14 agreed pairs are accepted, `process` + `died` only from `sync`; a bad [reason] or a
   * negative [observedAtMs] is [SyncDiaryEnqueueResult.REJECTED] too.
   */
  fun recordTransition(
    processName: String,
    subject: String,
    transition: String,
    reason: String?,
    observedAtMs: Long,
    nowMs: Long,
  ): SyncDiaryEnqueueResult {
    val isValid = isSyncDiaryTransition(processName, subject, transition) &&
      (reason == null || isSyncDiaryReason(reason)) &&
      observedAtMs >= 0L
    if (!isValid) {
      Log.w(TAG, "Rejected transition $processName/$subject/$transition")
      return SyncDiaryEnqueueResult.REJECTED
    }
    return inTransaction("recordTransition", SyncDiaryEnqueueResult.UNAVAILABLE) { database ->
      closeHours(database, nowMs)
      enqueueTransition(database, processName, subject, transition, reason, observedAtMs, nowMs)
    }
  }

  /**
   * Stores one report under [observationId] unless [limitKey] already stored [limitPerHour]
   * reports in the hour of [nowMs] ([SyncDiaryEnqueueResult.LIMITED]). The quota lives in the
   * telemetry database, so the main and `:sync` processes share it; only an inserted report spends
   * it, and older hours' quotas are deleted on the way.
   */
  fun enqueueLimitedReport(
    limitKey: String,
    limitPerHour: Int,
    observationId: String,
    payloadJson: String,
    nowMs: Long,
  ): SyncDiaryEnqueueResult =
    inTransaction("enqueueLimitedReport", SyncDiaryEnqueueResult.UNAVAILABLE) { database ->
      val hour = syncDiaryHourStart(nowMs)
      database.execSQL("DELETE FROM sync_diary_limits WHERE hour_start_ms < ?", arrayOf<Any>(hour))
      val used = database.rawQuery(
        "SELECT count FROM sync_diary_limits WHERE hour_start_ms = CAST(? AS INTEGER) AND limit_key = ?",
        arrayOf(hour.toString(), limitKey),
      ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }
      if (used >= limitPerHour) return@inTransaction SyncDiaryEnqueueResult.LIMITED

      val result = enqueue(database, observationId, payloadJson, nowMs)
      if (result == SyncDiaryEnqueueResult.INSERTED) {
        database.execSQL(
          "INSERT INTO sync_diary_limits (hour_start_ms, limit_key, count) VALUES (?, ?, 1) " +
            "ON CONFLICT(hour_start_ms, limit_key) DO UPDATE SET count = count + 1",
          arrayOf<Any>(hour, limitKey),
        )
      }
      result
    }

  /**
   * Reports `boot` + `started` when [bootTimeMs] (now minus `elapsedRealtime`) moved more than
   * [SYNC_DIARY_BOOT_TOLERANCE_MS] from the boot time either process stored last, with
   * `observed_at_ms` = [bootTimeMs]. The first boot time ever seen is only stored: nothing says it
   * is new. A boot both processes notice is reported once, because the check and the update share
   * one transaction.
   */
  fun recordBoot(processName: String, bootTimeMs: Long, nowMs: Long): SyncDiaryEnqueueResult {
    if (!isSyncDiaryTransition(processName, "boot", "started") || bootTimeMs < 0L) {
      return SyncDiaryEnqueueResult.REJECTED
    }
    return inTransaction("recordBoot", SyncDiaryEnqueueResult.UNAVAILABLE) { database ->
      val stored = readMark(database, BOOT_MARK)
      if (stored != null && Math.abs(stored - bootTimeMs) <= SYNC_DIARY_BOOT_TOLERANCE_MS) {
        return@inTransaction SyncDiaryEnqueueResult.UNCHANGED
      }
      writeMark(database, BOOT_MARK, bootTimeMs)
      if (stored == null) return@inTransaction SyncDiaryEnqueueResult.UNCHANGED
      closeHours(database, nowMs)
      enqueueTransition(database, processName, "boot", "started", null, bootTimeMs, nowMs)
    }
  }

  /**
   * Records every exit in [exits] newer than the last one already read for its process: a `sync`
   * exit as one `process` + `died` transition observed at Android's exit timestamp, a `main` exit
   * as one death counted in the hour of [nowMs] (S3, S4). The first read for a process only
   * stores its newest timestamp, so the history that predates the diary is never reported.
   * Answers how many exits were recorded; an exit off the vocabulary is skipped.
   */
  fun recordProcessExits(exits: List<SyncDiaryProcessExit>, nowMs: Long): Int =
    inTransaction("recordProcessExits", 0) { database ->
      closeHours(database, nowMs)
      var recorded = 0
      SYNC_DIARY_PROCESS_NAMES.forEach { processName ->
        val own = exits.filter { exit ->
          exit.processName == processName && exit.timestampMs >= 0L && isSyncDiaryReason(exit.reason)
        }
        val lastSeen = readMark(database, "$EXIT_MARK_PREFIX$processName")
        val newest = own.maxOfOrNull { it.timestampMs } ?: 0L
        writeMark(database, "$EXIT_MARK_PREFIX$processName", maxOf(newest, lastSeen ?: 0L))
        if (lastSeen == null) return@forEach
        own.filter { it.timestampMs > lastSeen }.sortedBy { it.timestampMs }.forEach { exit ->
          if (processName == "sync") {
            enqueueTransition(database, processName, "process", "died", exit.reason, exit.timestampMs, nowMs)
          } else {
            database.execSQL(UPSERT_DEATH_SQL, arrayOf<Any>(syncDiaryHourStart(nowMs), processName, exit.reason))
          }
          recorded += 1
        }
      }
      recorded
    }

  /** One validated transition, enqueued inside the caller's transaction under a fresh id. */
  private fun enqueueTransition(
    database: SQLiteDatabase,
    processName: String,
    subject: String,
    transition: String,
    reason: String?,
    observedAtMs: Long,
    nowMs: Long,
  ): SyncDiaryEnqueueResult {
    val observationId = newId()
    val body = buildSyncDiaryRuntimeTransition(
      SyncDiaryTransition(observationId, observedAtMs, processName, subject, transition, reason, appVersion),
    )
    return enqueue(database, observationId, body, nowMs)
  }

  private fun readMark(database: SQLiteDatabase, key: String): Long? =
    database.rawQuery("SELECT mark_value FROM sync_diary_marks WHERE mark_key = ?", arrayOf(key))
      .use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else null }

  private fun writeMark(database: SQLiteDatabase, key: String, value: Long) {
    database.execSQL(
      "INSERT INTO sync_diary_marks (mark_key, mark_value) VALUES (?, ?) " +
        "ON CONFLICT(mark_key) DO UPDATE SET mark_value = excluded.mark_value",
      arrayOf<Any>(key, value),
    )
  }

  /**
   * Emits one `hourly_summary` for every hour before the hour of [nowMs] that holds counts, deaths
   * or skipped reports, then deletes that hour's rows; the deletion is what resets its
   * `dropped_count`. Runs inside the caller's transaction, so a summary and its deletion land
   * together or not at all.
   */
  private fun closeHours(database: SQLiteDatabase, nowMs: Long) {
    val currentHour = syncDiaryHourStart(nowMs)
    val hours = database.rawQuery(CLOSED_HOURS_SQL, arrayOf(currentHour.toString())).use { cursor ->
      buildList { while (cursor.moveToNext()) add(cursor.getLong(0)) }
    }
    if (hours.isEmpty()) return
    val installId = readInstallId(database)
    hours.forEach { hour ->
      val summary = buildSyncDiaryHourlySummary(
        observationId = "$installId:$hour",
        hourStartMs = hour,
        counts = readCounts(database, hour),
        droppedCount = readDropped(database, hour),
        processDeaths = readDeaths(database, hour),
      )
      val hourArgument = arrayOf<Any>(hour)
      database.execSQL("DELETE FROM sync_diary_counts WHERE hour_start_ms = ?", hourArgument)
      database.execSQL("DELETE FROM sync_diary_deaths WHERE hour_start_ms = ?", hourArgument)
      database.execSQL("DELETE FROM sync_diary_drops WHERE hour_start_ms = ?", hourArgument)
      enqueue(database, "$installId:$hour", summary, nowMs)
    }
  }

  /** The insert behind [enqueueReport], inside the caller's transaction. */
  private fun enqueue(
    database: SQLiteDatabase,
    observationId: String,
    payloadJson: String,
    nowMs: Long,
  ): SyncDiaryEnqueueResult {
    val today = syncDiaryDayStart(nowMs)
    val storedToday = database.rawQuery(
      "SELECT CASE WHEN day_start_ms = CAST(? AS INTEGER) THEN day_count ELSE 0 END " +
        "FROM sync_diary_state WHERE id = 1",
      arrayOf(today.toString()),
    ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }
    val outboxRows = database.compileStatement("SELECT COUNT(*) FROM sync_diagnostics_outbox")
      .use { statement -> statement.simpleQueryForLong() }

    if (outboxRows >= SYNC_DIARY_OUTBOX_RESERVE_ROWS || storedToday >= SYNC_DIARY_DAILY_REPORT_LIMIT) {
      database.execSQL(UPSERT_DROP_SQL, arrayOf<Any>(syncDiaryHourStart(nowMs)))
      return SyncDiaryEnqueueResult.DROPPED
    }

    val inserted = database.compileStatement(OUTBOX_INSERT_SQL).use { statement ->
      statement.bindString(1, observationId)
      statement.bindString(2, payloadJson)
      statement.bindLong(3, nowMs)
      statement.executeUpdateDelete()
    }
    if (inserted == 0) return SyncDiaryEnqueueResult.DUPLICATE

    database.execSQL(
      "UPDATE sync_diary_state SET day_start_ms = ?, day_count = ? WHERE id = 1",
      arrayOf<Any>(today, storedToday + 1L),
    )
    return SyncDiaryEnqueueResult.INSERTED
  }

  /**
   * The install id, minted once (a random UUID) by the first diary transaction of whichever
   * process writes first, and read by every later one.
   */
  private fun readInstallId(database: SQLiteDatabase): String {
    database.rawQuery("SELECT install_id FROM sync_diary_state WHERE id = 1", null).use { cursor ->
      if (cursor.moveToFirst()) return cursor.getString(0)
    }
    val minted = newId()
    database.execSQL(
      "INSERT INTO sync_diary_state (id, install_id, day_start_ms, day_count) VALUES (1, ?, 0, 0)",
      arrayOf<Any>(minted),
    )
    return minted
  }

  private fun readCounts(database: SQLiteDatabase, hour: Long): List<SyncDiaryCount> =
    database.rawQuery(
      "SELECT trigger_source, outcome, count, max_duration_ms FROM sync_diary_counts " +
        "WHERE hour_start_ms = CAST(? AS INTEGER) ORDER BY trigger_source, outcome LIMIT $SYNC_DIARY_MAX_COUNT_ITEMS",
      arrayOf(hour.toString()),
    ).use { cursor ->
      buildList {
        while (cursor.moveToNext()) {
          add(
            SyncDiaryCount(
              triggerSource = cursor.getString(0),
              outcome = cursor.getString(1),
              count = cursor.getLong(2),
              maxDurationMs = if (cursor.isNull(3)) null else cursor.getLong(3),
            ),
          )
        }
      }
    }

  private fun readDeaths(database: SQLiteDatabase, hour: Long): List<SyncDiaryProcessDeath> =
    database.rawQuery(
      "SELECT process_name, reason, count FROM sync_diary_deaths WHERE hour_start_ms = CAST(? AS INTEGER) " +
        "ORDER BY count DESC, process_name, reason LIMIT $SYNC_DIARY_MAX_DEATH_ITEMS",
      arrayOf(hour.toString()),
    ).use { cursor ->
      buildList {
        while (cursor.moveToNext()) {
          add(SyncDiaryProcessDeath(cursor.getString(0), cursor.getString(1), cursor.getLong(2)))
        }
      }
    }

  private fun readDropped(database: SQLiteDatabase, hour: Long): Long =
    database.rawQuery(
      "SELECT dropped_count FROM sync_diary_drops WHERE hour_start_ms = CAST(? AS INTEGER)",
      arrayOf(hour.toString()),
    ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }

  /**
   * Runs [block] in one transaction on a fresh connection, answering [fallback] when the file is
   * missing or anything fails. The connection is opened `OPEN_READWRITE` only after an existence
   * check, because `openDatabase` would otherwise create a file this module does not own.
   */
  private fun <T> inTransaction(operation: String, fallback: T, block: (SQLiteDatabase) -> T): T =
    synchronized(PROCESS_LOCK) {
      if (!telemetryFile.exists()) return@synchronized fallback
      try {
        SQLiteDatabase.openDatabase(telemetryFile.path, null, SQLiteDatabase.OPEN_READWRITE).use { database ->
          database.compileStatement("PRAGMA busy_timeout = $SYNC_DIARY_BUSY_TIMEOUT_MS").use { it.execute() }
          database.execSQL(STATE_TABLE_SQL)
          database.execSQL(COUNTS_TABLE_SQL)
          database.execSQL(DEATHS_TABLE_SQL)
          database.execSQL(DROPS_TABLE_SQL)
          database.execSQL(MARKS_TABLE_SQL)
          database.execSQL(LIMITS_TABLE_SQL)
          database.beginTransaction()
          try {
            readInstallId(database)
            val result = block(database)
            database.setTransactionSuccessful()
            result
          } finally {
            database.endTransaction()
          }
        }
      } catch (error: Exception) {
        Log.w(TAG, "$operation failed; nothing recorded", error)
        fallback
      }
    }

  private companion object {
    /** One diary write at a time per process; across processes SQLite's own lock serializes them. */
    val PROCESS_LOCK = Any()
  }
}

/**
 * The diary of this app install, writing the telemetry database next to the app database and
 * naming the installed build's version on every transition.
 */
fun syncDiaryFor(context: Context): SyncDiary =
  SyncDiary(resolveSyncDiaryTelemetryFile(context.filesDir), readAppVersionName(context))

/** The installed build's version name, or `null` when the platform cannot answer. */
private fun readAppVersionName(context: Context): String? =
  try {
    val packageManager = context.packageManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.getPackageInfo(context.packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
    } else {
      @Suppress("DEPRECATION")
      packageManager.getPackageInfo(context.packageName, 0)
    }.versionName
  } catch (error: Exception) {
    null
  }
