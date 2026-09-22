package expo.modules.foregroundsyncticker

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock

/**
 * Broadcast action the manifest-declared [TickAlarmReceiver] listens for. Must stay in sync with
 * the intent-filter action declared for it in `plugins/withAndroidForegroundSync.js`; a mismatch
 * there arms an alarm nothing is registered to receive.
 */
internal const val TICK_ALARM_ACTION = "expo.modules.foregroundsyncticker.TICK_ALARM"

/**
 * Request code for the tick alarm's [PendingIntent]. Stable across app restarts so re-arming
 * always updates the same pending alarm (via [PendingIntent.FLAG_UPDATE_CURRENT]) instead of
 * stacking a second one.
 */
private const val TICK_ALARM_REQUEST_CODE = 2001

/**
 * SharedPreferences file that persists the ticking state across process death. This is what lets
 * [TickAlarmReceiver] -- woken with no React Native context and no [ForegroundSyncTickerModule]
 * instance to ask -- know whether it should re-arm the next alarm at all.
 */
private const val PREFS_NAME = "expo.modules.foregroundsyncticker.prefs"

/** SharedPreferences key for whether ticking is currently enabled. */
private const val PREF_IS_TICKING = "isTicking"

/** SharedPreferences key for the current tick interval, in milliseconds. */
private const val PREF_INTERVAL_MS = "intervalMs"

/**
 * Fallback interval if [readTickingState] is ever asked for one before [persistTickingState] has
 * run. `startTicking()` always persists its own interval before the first alarm is armed, so this
 * value is never actually scheduled -- it only keeps [readTickingState] total.
 */
private const val DEFAULT_INTERVAL_MS = 15_000L

/** The persisted tick-cadence state: whether ticking is enabled, and at what interval. */
internal data class TickingState(val isTicking: Boolean, val intervalMs: Long)

/**
 * Persists the ticking state so it outlives the process. This is what makes
 * [TickAlarmReceiver]'s re-arm conditional instead of unconditional: without a persisted flag, a
 * receiver woken by a stray or leftover alarm would have no way to know ticking was ever
 * stopped, and would re-arm forever -- waking the CPU every interval with no foreground service
 * and no JS able to act on it, which is worse than the bug this receiver exists to fix.
 */
internal fun persistTickingState(context: Context, isTicking: Boolean, intervalMs: Long) {
  context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    .edit()
    .putBoolean(PREF_IS_TICKING, isTicking)
    .putLong(PREF_INTERVAL_MS, intervalMs)
    .apply()
}

/** Reads the persisted ticking state. Defaults to not ticking when nothing was ever persisted. */
internal fun readTickingState(context: Context): TickingState {
  val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  return TickingState(
    isTicking = prefs.getBoolean(PREF_IS_TICKING, false),
    intervalMs = prefs.getLong(PREF_INTERVAL_MS, DEFAULT_INTERVAL_MS),
  )
}

/**
 * Builds the stable [PendingIntent] the tick alarm fires. Built in exactly this one place so the
 * module and the receiver never construct it separately -- a second construction site is how the
 * two would drift (different extras, different flags) and the alarm would stop being the one
 * `cancel()` or a later `set...WhileIdle()` call thinks it is addressing.
 */
private fun buildTickPendingIntent(context: Context): PendingIntent {
  val intent = Intent(TICK_ALARM_ACTION).setPackage(context.packageName)
  return PendingIntent.getBroadcast(
    context,
    TICK_ALARM_REQUEST_CODE,
    intent,
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
  )
}

/**
 * Arms the next tick alarm, [delayMs] from now. Called from both [ForegroundSyncTickerModule]
 * (initial arm on `start()`, and re-arm from persisted state on process start) and
 * [TickAlarmReceiver] (re-arm on every delivery) -- shared here so both sites schedule identically.
 */
internal fun scheduleNextTick(context: Context, delayMs: Long) {
  val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return

  val triggerAtElapsedMs = SystemClock.elapsedRealtime() + delayMs
  val pendingIntent = buildTickPendingIntent(context)

  // Inexact by design: setAndAllowWhileIdle is still elapsedRealtime-based and wakeup, so it
  // survives CPU suspension, but the system may batch or defer it (floor ~1/minute, longer in
  // Doze). No exact-alarm permission is requested.
  alarmManager.setAndAllowWhileIdle(
    AlarmManager.ELAPSED_REALTIME_WAKEUP,
    triggerAtElapsedMs,
    pendingIntent,
  )
}

/** Cancels the pending tick alarm, if any. Safe to call even when none is currently armed. */
internal fun cancelTickAlarm(context: Context) {
  val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
  alarmManager.cancel(buildTickPendingIntent(context))
}
