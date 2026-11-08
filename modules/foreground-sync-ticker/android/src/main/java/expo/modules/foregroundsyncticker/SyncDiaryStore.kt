package expo.modules.foregroundsyncticker

import android.database.sqlite.SQLiteDatabase

// The diary's tables inside `autoreas-telemetry.db` and the statements over them. Only the `:sync`
// process runs these (see [SyncDiary]); every function works inside the caller's transaction.

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

private const val UPSERT_COUNT_SQL =
  "INSERT INTO sync_diary_counts (hour_start_ms, trigger_source, outcome, count, max_duration_ms) " +
    "VALUES (?, ?, ?, 1, ?) ON CONFLICT(hour_start_ms, trigger_source, outcome) DO UPDATE SET " +
    "count = count + 1, max_duration_ms = MAX(max_duration_ms, excluded.max_duration_ms)"

private const val UPSERT_DEATH_SQL =
  "INSERT INTO sync_diary_deaths (hour_start_ms, process_name, reason, count) VALUES (?, ?, ?, 1) " +
    "ON CONFLICT(hour_start_ms, process_name, reason) DO UPDATE SET count = count + 1"

private const val ADD_DROPS_SQL =
  "INSERT INTO sync_diary_drops (hour_start_ms, dropped_count) VALUES (?, ?) " +
    "ON CONFLICT(hour_start_ms) DO UPDATE SET dropped_count = dropped_count + excluded.dropped_count"

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

/** Creates the diary's own `sync_diary_*` tables; never the JS-owned outbox. */
internal fun SQLiteDatabase.createSyncDiaryTables() {
  execSQL(STATE_TABLE_SQL)
  execSQL(COUNTS_TABLE_SQL)
  execSQL(DEATHS_TABLE_SQL)
  execSQL(DROPS_TABLE_SQL)
  execSQL(MARKS_TABLE_SQL)
  execSQL(LIMITS_TABLE_SQL)
}

/** Counts one attempt in the hour of [nowMs], keeping the pair's longest duration as measured. */
internal fun SQLiteDatabase.countSyncDiaryAttempt(triggerSource: String, outcome: String, durationMs: Long, nowMs: Long) {
  execSQL(UPSERT_COUNT_SQL, arrayOf<Any>(syncDiaryHourStart(nowMs), triggerSource, outcome, durationMs))
}

/** Counts one process death in the hour of [nowMs]. */
internal fun SQLiteDatabase.countSyncDiaryDeath(processName: String, reason: String, nowMs: Long) {
  execSQL(UPSERT_DEATH_SQL, arrayOf<Any>(syncDiaryHourStart(nowMs), processName, reason))
}

/** Adds [count] skipped reports to the `dropped_count` of the hour starting at [hourStartMs]. */
internal fun SQLiteDatabase.countSyncDiaryDrops(hourStartMs: Long, count: Long) {
  execSQL(ADD_DROPS_SQL, arrayOf<Any>(hourStartMs, count))
}

/** One mark's value, or `null` when it was never written. */
internal fun SQLiteDatabase.readSyncDiaryMark(key: String): Long? =
  rawQuery("SELECT mark_value FROM sync_diary_marks WHERE mark_key = ?", arrayOf(key))
    .use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else null }

/** Stores [value] under [key], replacing what was there. */
internal fun SQLiteDatabase.writeSyncDiaryMark(key: String, value: Long) {
  execSQL(
    "INSERT INTO sync_diary_marks (mark_key, mark_value) VALUES (?, ?) " +
      "ON CONFLICT(mark_key) DO UPDATE SET mark_value = excluded.mark_value",
    arrayOf<Any>(key, value),
  )
}

/**
 * Reports already stored for [limitKey] in the hour of [nowMs], deleting older hours' quotas on
 * the way.
 */
internal fun SQLiteDatabase.readSyncDiaryLimitUse(limitKey: String, nowMs: Long): Long {
  val hour = syncDiaryHourStart(nowMs)
  execSQL("DELETE FROM sync_diary_limits WHERE hour_start_ms < ?", arrayOf<Any>(hour))
  return rawQuery(
    "SELECT count FROM sync_diary_limits WHERE hour_start_ms = CAST(? AS INTEGER) AND limit_key = ?",
    arrayOf(hour.toString(), limitKey),
  ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }
}

/** Spends one of [limitKey]'s reports in the hour of [nowMs]. */
internal fun SQLiteDatabase.spendSyncDiaryLimit(limitKey: String, nowMs: Long) {
  execSQL(
    "INSERT INTO sync_diary_limits (hour_start_ms, limit_key, count) VALUES (?, ?, 1) " +
      "ON CONFLICT(hour_start_ms, limit_key) DO UPDATE SET count = count + 1",
    arrayOf<Any>(syncDiaryHourStart(nowMs), limitKey),
  )
}

/**
 * Emits one `hourly_summary` for every hour before the hour of [nowMs] that holds counts, deaths
 * or skipped reports, then deletes that hour's rows; the deletion is what resets its
 * `dropped_count`. A summary and its deletion share the caller's transaction.
 */
internal fun SQLiteDatabase.closeSyncDiaryHours(nowMs: Long, newId: () -> String) {
  val currentHour = syncDiaryHourStart(nowMs)
  val hours = rawQuery(CLOSED_HOURS_SQL, arrayOf(currentHour.toString())).use { cursor ->
    buildList { while (cursor.moveToNext()) add(cursor.getLong(0)) }
  }
  if (hours.isEmpty()) return
  val installId = readSyncDiaryInstallId(newId)
  hours.forEach { hour ->
    val summary = buildSyncDiaryHourlySummary(
      observationId = "$installId:$hour",
      hourStartMs = hour,
      counts = readCounts(hour),
      droppedCount = readDropped(hour),
      processDeaths = readDeaths(hour),
    )
    val hourArgument = arrayOf<Any>(hour)
    execSQL("DELETE FROM sync_diary_counts WHERE hour_start_ms = ?", hourArgument)
    execSQL("DELETE FROM sync_diary_deaths WHERE hour_start_ms = ?", hourArgument)
    execSQL("DELETE FROM sync_diary_drops WHERE hour_start_ms = ?", hourArgument)
    enqueueSyncDiaryReport("$installId:$hour", summary, nowMs)
  }
}

/**
 * Stores one report under [observationId] unless the outbox holds [SYNC_DIARY_OUTBOX_RESERVE_ROWS]
 * rows or [SYNC_DIARY_DAILY_REPORT_LIMIT] new-kind rows were stored this UTC day; a skipped report
 * is counted in the hour of [nowMs]. A repeated id keeps its first payload and costs no slot.
 */
internal fun SQLiteDatabase.enqueueSyncDiaryReport(
  observationId: String,
  payloadJson: String,
  nowMs: Long,
): SyncDiaryEnqueueResult {
  val today = syncDiaryDayStart(nowMs)
  val storedToday = rawQuery(
    "SELECT CASE WHEN day_start_ms = CAST(? AS INTEGER) THEN day_count ELSE 0 END " +
      "FROM sync_diary_state WHERE id = 1",
    arrayOf(today.toString()),
  ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }
  val outboxRows = compileStatement("SELECT COUNT(*) FROM sync_diagnostics_outbox")
    .use { statement -> statement.simpleQueryForLong() }

  if (outboxRows >= SYNC_DIARY_OUTBOX_RESERVE_ROWS || storedToday >= SYNC_DIARY_DAILY_REPORT_LIMIT) {
    countSyncDiaryDrops(syncDiaryHourStart(nowMs), 1L)
    return SyncDiaryEnqueueResult.DROPPED
  }

  val inserted = compileStatement(OUTBOX_INSERT_SQL).use { statement ->
    statement.bindString(1, observationId)
    statement.bindString(2, payloadJson)
    statement.bindLong(3, nowMs)
    statement.executeUpdateDelete()
  }
  if (inserted == 0) return SyncDiaryEnqueueResult.DUPLICATE

  execSQL(
    "UPDATE sync_diary_state SET day_start_ms = ?, day_count = ? WHERE id = 1",
    arrayOf<Any>(today, storedToday + 1L),
  )
  return SyncDiaryEnqueueResult.INSERTED
}

/**
 * The install id, minted once (a random UUID) by the first diary transaction, and read by every
 * later one.
 */
internal fun SQLiteDatabase.readSyncDiaryInstallId(newId: () -> String): String {
  rawQuery("SELECT install_id FROM sync_diary_state WHERE id = 1", null).use { cursor ->
    if (cursor.moveToFirst()) return cursor.getString(0)
  }
  val minted = newId()
  execSQL(
    "INSERT INTO sync_diary_state (id, install_id, day_start_ms, day_count) VALUES (1, ?, 0, 0)",
    arrayOf<Any>(minted),
  )
  return minted
}

private fun SQLiteDatabase.readCounts(hour: Long): List<SyncDiaryCount> =
  rawQuery(
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

private fun SQLiteDatabase.readDeaths(hour: Long): List<SyncDiaryProcessDeath> =
  rawQuery(
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

private fun SQLiteDatabase.readDropped(hour: Long): Long =
  rawQuery(
    "SELECT dropped_count FROM sync_diary_drops WHERE hour_start_ms = CAST(? AS INTEGER)",
    arrayOf(hour.toString()),
  ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }
