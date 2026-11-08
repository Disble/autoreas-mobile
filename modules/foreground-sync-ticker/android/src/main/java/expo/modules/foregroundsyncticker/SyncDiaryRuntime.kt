package expo.modules.foregroundsyncticker

import android.app.ActivityManager
import android.app.Application
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.util.Log
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Log tag for a runtime record that failed; a failure is logged and swallowed, never thrown. */
private const val TAG = "SyncDiaryRuntime"

/** Suffix Android gives the dedicated sync process (`android:process=":sync"`). */
const val SYNC_DIARY_SYNC_PROCESS_SUFFIX = ":sync"

/** A boot time that moved by more than this is a new boot, not clock drift. */
const val SYNC_DIARY_BOOT_TOLERANCE_MS = 60_000L

/** One process exit read from Android's history, already mapped onto the diary's vocabulary. */
data class SyncDiaryProcessExit(
  val processName: String,
  val reason: String,
  val timestampMs: Long,
)

/**
 * The diary's door for real runtime state changes (odd/tasks/mobile-report-kinds.md S4), shared by
 * this module and `sync-engine`: it names the process a change happened in, runs the record off the
 * caller's thread (service callbacks and the JS-facing module run on main or JS threads), and never
 * throws, so a diary failure can never change the behaviour it describes.
 *
 * The `var`s are seams for the unit tests of both modules, which run every record inline and pin
 * the clocks, the process name and the exit history; production never reassigns them.
 */
object SyncDiaryRuntime {
  /** Runs each record; a single background thread in production, inline in tests. */
  @Volatile
  var executor: Executor = defaultExecutor()

  /** Wall clock every record is stamped with. */
  @Volatile
  var clock: () -> Long = System::currentTimeMillis

  /** Monotonic time since boot, which turns the wall clock into the boot time. */
  @Volatile
  var elapsedRealtime: () -> Long = SystemClock::elapsedRealtime

  /** The name of the process the code runs in, or `null` when the platform cannot tell. */
  @Volatile
  var processNameReader: (Context) -> String? = ::readCurrentProcessName

  /** This app's process exits as Android recorded them (API 30+; empty below). */
  @Volatile
  var exitReader: (Context) -> List<SyncDiaryProcessExit> = ::readSyncDiaryProcessExits

  /** True once this process reported its own start; statics are per process, so is this flag. */
  private val hasNotedProcessStart = AtomicBoolean(false)

  /** `sync` inside the dedicated `:sync` process, `main` everywhere else. */
  fun processName(context: Context): String =
    if (processNameReader(context)?.endsWith(SYNC_DIARY_SYNC_PROCESS_SUFFIX) == true) "sync" else "main"

  /** Reports one real state change of this process; see [SyncDiary.recordTransition]. */
  fun recordTransition(context: Context, subject: String, transition: String, reason: String? = null) {
    val appContext = context.applicationContext ?: context
    submit("recordTransition $subject/$transition") { now ->
      syncDiaryFor(appContext).recordTransition(processName(appContext), subject, transition, reason, now, now)
    }
  }

  /**
   * Reports this process's start, once per process however often it is called, then reads what
   * happened while it was gone: Android's exit history ([SyncDiary.recordProcessExits]) and a
   * reboot ([SyncDiary.recordBoot]). There is no boot receiver (S6): a reboot is noticed by the
   * first process that starts after it.
   */
  fun noteProcessStart(context: Context) {
    if (!hasNotedProcessStart.compareAndSet(false, true)) return
    val appContext = context.applicationContext ?: context
    submit("noteProcessStart") { now ->
      val processName = processName(appContext)
      val diary = syncDiaryFor(appContext)
      diary.recordTransition(processName, "process", "started", null, now, now)
      diary.recordProcessExits(exitReader(appContext), now)
      diary.recordBoot(processName, now - elapsedRealtime(), now)
    }
  }

  /** Restores every seam and forgets the process start, so tests never leak into each other. */
  fun resetForTest() {
    executor = defaultExecutor()
    clock = System::currentTimeMillis
    elapsedRealtime = SystemClock::elapsedRealtime
    processNameReader = ::readCurrentProcessName
    exitReader = ::readSyncDiaryProcessExits
    hasNotedProcessStart.set(false)
  }

  private fun submit(operation: String, record: (Long) -> Unit) {
    try {
      executor.execute {
        try {
          record(clock())
        } catch (error: Throwable) {
          Log.w(TAG, "$operation failed; nothing recorded", error)
        }
      }
    } catch (error: Throwable) {
      Log.w(TAG, "$operation could not be scheduled", error)
    }
  }

  private fun defaultExecutor(): Executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "SyncDiaryRuntime").apply { isDaemon = true }
  }
}

/**
 * A thrown error's class as a recorded reason: `ForegroundServiceStartNotAllowedException` becomes
 * `foreground_service_start_not_allowed`. Only the class name is used, never the message (S2's
 * rule for errors); a name that does not fit `^[a-z0-9_]{1,40}$` after trimming becomes `unknown`.
 */
fun syncDiaryReasonFromError(error: Throwable): String {
  val snake = error.javaClass.simpleName
    .replace(Regex("([a-z0-9])([A-Z])"), "$1_$2")
    .lowercase()
    .removeSuffix("_exception")
    .removeSuffix("_error")
    .take(40)
    .trimEnd('_')
  return if (isSyncDiaryReason(snake)) snake else "unknown"
}

/** Android's exit reason as a recorded reason; an unlisted code becomes `other`. */
fun syncDiaryExitReason(reason: Int): String = when (reason) {
  ApplicationExitInfo.REASON_ANR -> "anr"
  ApplicationExitInfo.REASON_CRASH -> "crash"
  ApplicationExitInfo.REASON_CRASH_NATIVE -> "crash_native"
  ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "dependency_died"
  ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessive_resource_usage"
  ApplicationExitInfo.REASON_EXIT_SELF -> "exit_self"
  ApplicationExitInfo.REASON_FREEZER -> "freezer"
  ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "initialization_failure"
  ApplicationExitInfo.REASON_LOW_MEMORY -> "low_memory"
  ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "package_state_change"
  ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "package_updated"
  ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "permission_change"
  ApplicationExitInfo.REASON_SIGNALED -> "signaled"
  ApplicationExitInfo.REASON_UNKNOWN -> "unknown"
  ApplicationExitInfo.REASON_USER_REQUESTED -> "user_requested"
  ApplicationExitInfo.REASON_USER_STOPPED -> "user_stopped"
  else -> "other"
}

/**
 * The diary's process name for one of this app's process names: `sync` for the `:sync` process,
 * `main` for the package's own process, `null` for any other.
 */
fun syncDiaryProcessNameOf(packageName: String, processName: String): String? = when {
  processName.endsWith(SYNC_DIARY_SYNC_PROCESS_SUFFIX) -> "sync"
  processName == packageName -> "main"
  else -> null
}

/** Every exit Android still remembers for this app (API 30+), mapped; empty when unreadable. */
private fun readSyncDiaryProcessExits(context: Context): List<SyncDiaryProcessExit> {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return emptyList()
  val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return emptyList()
  return activityManager.getHistoricalProcessExitReasons(context.packageName, 0, 0).mapNotNull { info ->
    syncDiaryProcessNameOf(context.packageName, info.processName)?.let { name ->
      SyncDiaryProcessExit(name, syncDiaryExitReason(info.reason), info.timestamp)
    }
  }
}

/** This process's name: `Application.getProcessName()` on API 28+, the running list below. */
private fun readCurrentProcessName(context: Context): String? {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return Application.getProcessName()
  val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return null
  val pid = Process.myPid()
  return activityManager.runningAppProcesses?.firstOrNull { it.pid == pid }?.processName
}
