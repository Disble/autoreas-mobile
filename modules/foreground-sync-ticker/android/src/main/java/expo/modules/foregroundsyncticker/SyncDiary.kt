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

  /** Skipped by the 60-row reserve, the daily limit or the inbox cap, and counted in `dropped_count`. */
  DROPPED,

  /** Off the agreed vocabulary; nothing stored. */
  REJECTED,

  /** No telemetry database to write (file missing, outbox not provisioned, or a SQLite failure). */
  UNAVAILABLE,

  /** The hour's quota for this report's limit key is spent; nothing stored and nothing dropped. */
  LIMITED,

  /** Nothing changed since the last record (the same boot, a service still refused): nothing to report. */
  UNCHANGED,

  /** Queued in the main process's inbox; the `:sync` process moves it into the outbox. */
  QUEUED,
}

/** Log tag for every diary failure; a failure is logged and swallowed, never thrown. */
private const val TAG = "SyncDiary"

/** Mark holding the boot time last seen by either process. */
private const val BOOT_MARK = "boot_time_ms"

/** Prefix of the mark holding the newest exit timestamp already read for one process. */
private const val EXIT_MARK_PREFIX = "exit_seen_ms:"

/**
 * The tablet's durable sync diary (odd/tasks/mobile-report-kinds.md S3-S6): hourly counts of sync
 * attempts and process deaths, and `runtime_transition` reports, written into the diagnostics
 * outbox of `autoreas-telemetry.db` so the existing drains deliver them.
 *
 * It lives in this module because `sync-engine` depends on it and never the reverse. It owns the
 * DDL of its own `sync_diary_*` tables and never the outbox's: the JS store creates
 * `sync_diagnostics_outbox`. It never creates the telemetry file either -- a missing file makes
 * every call a no-op.
 *
 * Only the `:sync` process ([isSyncProcess]) opens the telemetry file. In the main process JS
 * holds an expo-sqlite connection to it, so a call made there is queued in [SyncDiaryInbox]
 * instead, and every `:sync` call first replays that queue in order with each call's own time, so
 * hours, limits and summaries come out as if the main process had written them itself.
 *
 * Every call runs in ONE transaction on its own short-lived connection (busy timeout
 * [SYNC_DIARY_BUSY_TIMEOUT_MS]) and never throws: a diary failure is logged and answered with a
 * neutral result, because it must never hurt sync. There is no timer (S6): every record call first
 * closes the hours that ended before it, emitting one `hourly_summary` for each.
 */
class SyncDiary(
  private val telemetryFile: File,
  appVersion: String?,
  private val isSyncProcess: Boolean,
  inboxFile: File = File(telemetryFile.absoluteFile.parentFile, SYNC_DIARY_INBOX_DATABASE_NAME),
  inboxMaxRows: Int = SYNC_DIARY_INBOX_MAX_ROWS,
  private val newId: () -> String = { UUID.randomUUID().toString() },
) {
  private val appVersion = sanitizeSyncDiaryAppVersion(appVersion)
  private val inbox = SyncDiaryInbox(inboxFile, inboxMaxRows)

  /**
   * Stores one new-kind report under [observationId] (its outbox `cycle_id`), unless the outbox
   * already holds [SYNC_DIARY_OUTBOX_RESERVE_ROWS] rows or [SYNC_DIARY_DAILY_REPORT_LIMIT] new-kind
   * rows were stored this UTC day; a skipped report is counted in the hour of [nowMs] and named by
   * that hour's summary. A repeated id keeps its first payload and costs no daily slot.
   */
  fun enqueueReport(observationId: String, payloadJson: String, nowMs: Long): SyncDiaryEnqueueResult {
    if (!isSyncProcess) {
      return queue(SyncDiaryInboxCall.Report(observationId, payloadJson), nowMs)
    }
    return inTransaction("enqueueReport", SyncDiaryEnqueueResult.UNAVAILABLE) { session ->
      session.database.enqueueSyncDiaryReport(observationId, payloadJson, nowMs)
    }
  }

  /**
   * Counts one sync attempt in the hour of [nowMs] and keeps the pair's longest duration. Answers
   * `false` when the attempt was not counted or queued: an off-list [triggerSource] or [outcome],
   * no database to write, or a full inbox.
   */
  fun recordAttempt(triggerSource: String, outcome: String, durationMs: Long, nowMs: Long): Boolean {
    if (triggerSource !in SYNC_DIARY_TRIGGER_SOURCES || outcome !in SYNC_DIARY_OUTCOMES) {
      Log.w(TAG, "Rejected attempt $triggerSource/$outcome")
      return false
    }
    if (!isSyncProcess) {
      return queue(SyncDiaryInboxCall.Attempt(triggerSource, outcome, durationMs), nowMs) == SyncDiaryEnqueueResult.QUEUED
    }
    return inTransaction("recordAttempt", false) { session ->
      applyAttempt(session.database, triggerSource, outcome, durationMs, nowMs)
      true
    }
  }

  /**
   * Counts one process death in the hour it is read ([nowMs]), not the hour it happened (S3).
   * Answers `false` for an unknown [processName], a [reason] off `^[a-z0-9_]{1,40}$`, no database
   * to write, or a full inbox.
   */
  fun recordProcessDeath(processName: String, reason: String, nowMs: Long): Boolean {
    if (processName !in SYNC_DIARY_PROCESS_NAMES || !isSyncDiaryReason(reason)) {
      Log.w(TAG, "Rejected process death $processName/$reason")
      return false
    }
    if (!isSyncProcess) {
      return queue(SyncDiaryInboxCall.Death(processName, reason), nowMs) == SyncDiaryEnqueueResult.QUEUED
    }
    return inTransaction("recordProcessDeath", false) { session ->
      applyDeath(session.database, processName, reason, nowMs)
      true
    }
  }

  /**
   * Reports one real state change as a `runtime_transition` (S4), under a fresh observation id.
   * Only the 14 agreed pairs are accepted, `process` + `died` only from `sync`; a bad [reason] or a
   * negative [observedAtMs] is [SyncDiaryEnqueueResult.REJECTED] too. `service` + `refused` is a
   * change only while the service is not already refused: a refusal repeated by every tick is
   * [SyncDiaryEnqueueResult.UNCHANGED] until `service` + `started` is recorded again.
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
    val onceMark = SYNC_DIARY_SERVICE_REFUSED_MARK.takeIf { subject == "service" && transition == "refused" }
    if (!isSyncProcess) {
      val call = SyncDiaryInboxCall.Transition(processName, subject, transition, reason, observedAtMs, newId(), appVersion)
      return queue(call, nowMs, onceMark)
    }
    return inTransaction("recordTransition", SyncDiaryEnqueueResult.UNAVAILABLE) { session ->
      if (onceMark != null && !inbox.claimMark(session.inboxDatabase, onceMark)) {
        return@inTransaction SyncDiaryEnqueueResult.UNCHANGED
      }
      applyTransition(session, processName, subject, transition, reason, observedAtMs, nowMs, newId(), appVersion)
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
  ): SyncDiaryEnqueueResult {
    if (!isSyncProcess) {
      return queue(SyncDiaryInboxCall.LimitedReport(limitKey, limitPerHour, observationId, payloadJson), nowMs)
    }
    return inTransaction("enqueueLimitedReport", SyncDiaryEnqueueResult.UNAVAILABLE) { session ->
      applyLimitedReport(session.database, limitKey, limitPerHour, observationId, payloadJson, nowMs)
    }
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
    if (!isSyncProcess) {
      return queue(SyncDiaryInboxCall.Boot(processName, bootTimeMs, appVersion), nowMs)
    }
    return inTransaction("recordBoot", SyncDiaryEnqueueResult.UNAVAILABLE) { session ->
      applyBoot(session.database, processName, bootTimeMs, nowMs, appVersion)
    }
  }

  /**
   * Records every exit in [exits] newer than the last one already read for its process: a `sync`
   * exit as one `process` + `died` transition observed at Android's exit timestamp, a `main` exit
   * as one death counted in the hour of [nowMs] (S3, S4). The first read for a process only
   * stores its newest timestamp, so the history that predates the diary is never reported.
   * Answers how many exits were recorded -- `0` in the main process, whose exits are recorded when
   * `:sync` moves them -- and skips an exit off the vocabulary.
   */
  fun recordProcessExits(exits: List<SyncDiaryProcessExit>, nowMs: Long): Int {
    if (!isSyncProcess) {
      queue(SyncDiaryInboxCall.Exits(exits, appVersion), nowMs)
      return 0
    }
    return inTransaction("recordProcessExits", 0) { session -> applyExits(session, exits, nowMs, appVersion) }
  }

  /**
   * Moves what the main process queued into the outbox, as every `:sync` call does before its own
   * work, and answers how many calls were moved. A no-op answering `0` in the main process or when
   * nothing was ever queued.
   */
  fun drainInbox(): Int {
    if (!isSyncProcess || !inbox.file.exists()) return 0
    return inTransaction("drainInbox", 0) { session -> session.moved }
  }

  private fun applyAttempt(database: SQLiteDatabase, triggerSource: String, outcome: String, durationMs: Long, nowMs: Long) {
    database.closeSyncDiaryHours(nowMs, newId)
    // Stored as measured; the summary clamps it to the Bridge's bounds.
    database.countSyncDiaryAttempt(triggerSource, outcome, durationMs, nowMs)
  }

  private fun applyDeath(database: SQLiteDatabase, processName: String, reason: String, nowMs: Long) {
    database.closeSyncDiaryHours(nowMs, newId)
    database.countSyncDiaryDeath(processName, reason, nowMs)
  }

  private fun applyTransition(
    session: Session,
    processName: String,
    subject: String,
    transition: String,
    reason: String?,
    observedAtMs: Long,
    nowMs: Long,
    observationId: String,
    version: String,
  ): SyncDiaryEnqueueResult {
    session.database.closeSyncDiaryHours(nowMs, newId)
    // The service runs again, so its next refusal is a change worth reporting.
    if (subject == "service" && transition == "started") {
      inbox.clearMark(session.inboxDatabase, SYNC_DIARY_SERVICE_REFUSED_MARK)
    }
    return enqueueTransition(session.database, processName, subject, transition, reason, observedAtMs, nowMs, observationId, version)
  }

  private fun applyLimitedReport(
    database: SQLiteDatabase,
    limitKey: String,
    limitPerHour: Int,
    observationId: String,
    payloadJson: String,
    nowMs: Long,
  ): SyncDiaryEnqueueResult {
    if (database.readSyncDiaryLimitUse(limitKey, nowMs) >= limitPerHour) return SyncDiaryEnqueueResult.LIMITED
    val result = database.enqueueSyncDiaryReport(observationId, payloadJson, nowMs)
    if (result == SyncDiaryEnqueueResult.INSERTED) database.spendSyncDiaryLimit(limitKey, nowMs)
    return result
  }

  private fun applyBoot(
    database: SQLiteDatabase,
    processName: String,
    bootTimeMs: Long,
    nowMs: Long,
    version: String,
  ): SyncDiaryEnqueueResult {
    val stored = database.readSyncDiaryMark(BOOT_MARK)
    if (stored != null && Math.abs(stored - bootTimeMs) <= SYNC_DIARY_BOOT_TOLERANCE_MS) {
      return SyncDiaryEnqueueResult.UNCHANGED
    }
    database.writeSyncDiaryMark(BOOT_MARK, bootTimeMs)
    if (stored == null) return SyncDiaryEnqueueResult.UNCHANGED
    database.closeSyncDiaryHours(nowMs, newId)
    return enqueueTransition(database, processName, "boot", "started", null, bootTimeMs, nowMs, newId(), version)
  }

  private fun applyExits(session: Session, exits: List<SyncDiaryProcessExit>, nowMs: Long, version: String): Int {
    val database = session.database
    database.closeSyncDiaryHours(nowMs, newId)
    var recorded = 0
    SYNC_DIARY_PROCESS_NAMES.forEach { processName ->
      val own = exits.filter { exit ->
        exit.processName == processName && exit.timestampMs >= 0L && isSyncDiaryReason(exit.reason)
      }
      val lastSeen = database.readSyncDiaryMark("$EXIT_MARK_PREFIX$processName")
      val newest = own.maxOfOrNull { it.timestampMs } ?: 0L
      database.writeSyncDiaryMark("$EXIT_MARK_PREFIX$processName", maxOf(newest, lastSeen ?: 0L))
      if (lastSeen == null) return@forEach
      own.filter { it.timestampMs > lastSeen }.sortedBy { it.timestampMs }.forEach { exit ->
        if (processName == "sync") {
          enqueueTransition(database, processName, "process", "died", exit.reason, exit.timestampMs, nowMs, newId(), version)
        } else {
          database.countSyncDiaryDeath(processName, exit.reason, nowMs)
        }
        recorded += 1
      }
    }
    return recorded
  }

  /**
   * One validated transition, enqueued inside the caller's transaction under [observationId] and
   * naming [version], the build of the process that made the call.
   */
  private fun enqueueTransition(
    database: SQLiteDatabase,
    processName: String,
    subject: String,
    transition: String,
    reason: String?,
    observedAtMs: Long,
    nowMs: Long,
    observationId: String,
    version: String,
  ): SyncDiaryEnqueueResult {
    val body = buildSyncDiaryRuntimeTransition(
      SyncDiaryTransition(observationId, observedAtMs, processName, subject, transition, reason, version),
    )
    return database.enqueueSyncDiaryReport(observationId, body, nowMs)
  }

  /**
   * Replays every queued main-process call in order, each at its own time, then deletes what it
   * moved; the inbox cap's drop counts join the outbox's. A call that cannot be read is counted as
   * dropped in its hour instead of blocking every later drain.
   */
  private fun replayInbox(session: Session): Int {
    val inboxDatabase = session.inboxDatabase
    inbox.drops(inboxDatabase).forEach { (hour, count) -> session.database.countSyncDiaryDrops(hour, count) }
    val entries = inbox.entries(inboxDatabase)
    entries.forEach { entry ->
      try {
        replay(session, SyncDiaryInboxCall.decode(entry.kind, entry.args), entry.nowMs)
      } catch (error: Exception) {
        Log.w(TAG, "Unreadable inbox ${entry.kind}; counted as dropped", error)
        session.database.countSyncDiaryDrops(syncDiaryHourStart(entry.nowMs), 1L)
      }
    }
    inbox.clear(inboxDatabase, entries.lastOrNull()?.seq ?: 0L)
    return entries.size
  }

  private fun replay(session: Session, call: SyncDiaryInboxCall, nowMs: Long) {
    val database = session.database
    when (call) {
      is SyncDiaryInboxCall.Report -> database.enqueueSyncDiaryReport(call.observationId, call.payloadJson, nowMs)
      is SyncDiaryInboxCall.Attempt -> applyAttempt(database, call.triggerSource, call.outcome, call.durationMs, nowMs)
      is SyncDiaryInboxCall.Death -> applyDeath(database, call.processName, call.reason, nowMs)
      is SyncDiaryInboxCall.Transition -> applyTransition(
        session,
        call.processName,
        call.subject,
        call.transition,
        call.reason,
        call.observedAtMs,
        nowMs,
        call.observationId,
        sanitizeSyncDiaryAppVersion(call.appVersion),
      )
      is SyncDiaryInboxCall.LimitedReport ->
        applyLimitedReport(database, call.limitKey, call.limitPerHour, call.observationId, call.payloadJson, nowMs)
      is SyncDiaryInboxCall.Boot ->
        applyBoot(database, call.processName, call.bootTimeMs, nowMs, sanitizeSyncDiaryAppVersion(call.appVersion))
      is SyncDiaryInboxCall.Exits -> applyExits(session, call.exits, nowMs, sanitizeSyncDiaryAppVersion(call.appVersion))
    }
  }

  /**
   * Queues one main-process call in the inbox, never touching the telemetry file beyond checking
   * that it exists: without it there is nothing to deliver to. With [onceMark], the call is
   * queued only when the mark was not already set ([SyncDiaryEnqueueResult.UNCHANGED]).
   */
  private fun queue(call: SyncDiaryInboxCall, nowMs: Long, onceMark: String? = null): SyncDiaryEnqueueResult =
    synchronized(PROCESS_LOCK) {
      if (!telemetryFile.exists()) return@synchronized SyncDiaryEnqueueResult.UNAVAILABLE
      try {
        inbox.inTransaction { database ->
          when {
            onceMark != null && !inbox.claimMark(database, onceMark) -> SyncDiaryEnqueueResult.UNCHANGED
            inbox.queue(database, call.kind, nowMs, call.args()) -> SyncDiaryEnqueueResult.QUEUED
            else -> SyncDiaryEnqueueResult.DROPPED
          }
        }
      } catch (error: Exception) {
        Log.w(TAG, "Queueing ${call.kind} failed; nothing recorded", error)
        SyncDiaryEnqueueResult.UNAVAILABLE
      }
    }

  /**
   * Runs [block] in one telemetry transaction on a fresh connection, after replaying the inbox
   * into it, answering [fallback] when the file is missing or anything fails. The connection is
   * opened `OPEN_READWRITE` only after an existence check, because `openDatabase` would otherwise
   * create a file this module does not own. The inbox commits only after the telemetry file did,
   * so a failed drain leaves every queued call in place.
   */
  private fun <T> inTransaction(operation: String, fallback: T, block: (Session) -> T): T =
    synchronized(PROCESS_LOCK) {
      if (!telemetryFile.exists()) return@synchronized fallback
      try {
        inbox.inTransaction { inboxDatabase ->
          SQLiteDatabase.openDatabase(telemetryFile.path, null, SQLiteDatabase.OPEN_READWRITE).use { database ->
            database.compileStatement("PRAGMA busy_timeout = $SYNC_DIARY_BUSY_TIMEOUT_MS").use { it.execute() }
            database.createSyncDiaryTables()
            database.beginTransaction()
            try {
              database.readSyncDiaryInstallId(newId)
              val session = Session(database, inboxDatabase)
              session.moved = replayInbox(session)
              val result = block(session)
              database.setTransactionSuccessful()
              result
            } finally {
              database.endTransaction()
            }
          }
        }
      } catch (error: Exception) {
        Log.w(TAG, "$operation failed; nothing recorded", error)
        fallback
      }
    }

  /** The two connections of one `:sync` call, and how many inbox calls its drain moved. */
  private class Session(val database: SQLiteDatabase, val inboxDatabase: SQLiteDatabase) {
    var moved = 0
  }

  private companion object {
    /** One diary write at a time per process; across processes SQLite's own lock serializes them. */
    val PROCESS_LOCK = Any()
  }
}

/**
 * The diary of this app install, writing the telemetry database next to the app database from the
 * `:sync` process and the inbox beside it from any other, and naming the installed build's version
 * on every transition.
 */
fun syncDiaryFor(context: Context): SyncDiary =
  SyncDiary(
    resolveSyncDiaryTelemetryFile(context.filesDir),
    readAppVersionName(context),
    isSyncProcess = SyncDiaryRuntime.processName(context) == "sync",
  )

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
