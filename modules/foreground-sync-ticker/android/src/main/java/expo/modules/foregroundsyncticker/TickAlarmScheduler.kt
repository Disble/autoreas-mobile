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
 * Stable, ticker-owned answer to "does the native ticker own the background right now?".
 *
 * **Why this exists (ODD native-background-sync-cutover M2).** `modules/sync-engine` adds a native
 * `WorkManager` floor that must skip its own attempt while this ticker owns the background -- the
 * exact gate the JS floor already applies through `createNativeForegroundSyncTicker().isRunning()`
 * (`src/features/sync/background-sync.helpers.ts`). A native worker has no JS module registry to
 * ask, so the check has to be reachable from Kotlin.
 *
 * **Ownership direction.** `sync-engine` may depend on this module (`implementation
 * project(':foreground-sync-ticker')` in its `build.gradle`); the reverse is what every doc in
 * both modules forbids, and this object does not create it: it is a plain read of the OS-level
 * alarm token this module owns, with no reference to `sync-engine` at all.
 *
 * **Source of truth: the armed alarm's own `PendingIntent` token, not the persisted flag (T3 slice
 * A).** The floor is moving into its own `:sync` process, and [readTickingState] cannot answer
 * across a process boundary: `SharedPreferences` is cached in memory per process and
 * [persistTickingState] writes with `apply()`, so a second process would read a stale value -- it
 * would keep running alongside the armed ticker, or keep skipping every tick after a stop until
 * that process died. The alarm token, by contrast, lives in the system's `ActivityManager`, keyed
 * by action, request code, package and mutability, so "is the tick alarm armed?" is the same
 * answer from every process of this app: true while [scheduleNextTick] has armed it, false once
 * [cancelTickAlarm] has cancelled it. The persisted flag keeps both of its existing jobs --
 * [TickAlarmReceiver]'s re-arm decision and the interval read -- and is simply no longer what this
 * query answers with.
 *
 * **Reads the token, never creates it.** The lookup passes [PendingIntent.FLAG_NO_CREATE], so
 * asking never creates the token it is asking about: a process that never armed the ticker keeps
 * answering `false` however many times it asks. `FLAG_IMMUTABLE` mirrors the flag the single
 * builder arms with, because the system matches a looked-up token against the flags of the
 * original record. Never throws: a missing token resolves to `null`, i.e. "not armed".
 *
 * **Why not reflection, and not a duplicated construction.** Reflection over this module's private
 * state would break silently on a rename, with no compile error and no test failure in the calling
 * module; rebuilding the `PendingIntent` from the caller side would hardcode this module's action,
 * request code and flags into a second module, where a rename would keep compiling and silently
 * answer `false` forever -- a *delivery* bug (the floor would run alongside the ticker, not skip).
 * Exposing the read through this one function keeps both details private here and makes a rename a
 * compile error at the call site instead.
 */
object SyncTickerOwnership {
  fun ownsBackground(context: Context): Boolean = findTickPendingIntent(context) != null
}

/**
 * Builds the [Intent] the tick alarm's [PendingIntent] wraps. Extracted so the arming path, the
 * cancellation path and the ownership query all address the exact same token: `PendingIntent`
 * identity is (type, request code, intent `filterEquals`, relevant flags), so a second construction
 * site with a different action or package is how the query would silently stop finding the alarm
 * it is asking about.
 */
private fun buildTickIntent(context: Context): Intent =
  Intent(TICK_ALARM_ACTION).setPackage(context.packageName)

/**
 * Builds (or updates) the stable [PendingIntent] the tick alarm fires, via
 * `PendingIntent.FLAG_UPDATE_CURRENT`.
 * The module and the receiver both arm through this one function -- a second *arming* site is how
 * the two would drift (different extras, different flags) and the alarm would stop being the one
 * `cancel()` or a later `set...WhileIdle()` call thinks it is addressing. [findTickPendingIntent]
 * deliberately shares only [buildTickIntent] with this, never these flags: a lookup must not create.
 */
private fun buildTickPendingIntent(context: Context): PendingIntent {
  return PendingIntent.getBroadcast(
    context,
    TICK_ALARM_REQUEST_CODE,
    buildTickIntent(context),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
  )
}

/**
 * Looks up the tick alarm's already-armed [PendingIntent] token, or `null` when nothing is armed.
 *
 * [PendingIntent.FLAG_NO_CREATE] is the whole point: this is a query, and it must never arm the
 * alarm it is asked about. It is what makes [SyncTickerOwnership.ownsBackground] side-effect free
 * for a process that never armed the ticker, and it is also why [cancelTickAlarm] uses it rather
 * than the arming builder -- cancelling must not create the token it is cancelling.
 */
private fun findTickPendingIntent(context: Context): PendingIntent? {
  return PendingIntent.getBroadcast(
    context,
    TICK_ALARM_REQUEST_CODE,
    buildTickIntent(context),
    PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
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
  // survives CPU suspension. Android's Doze documentation states the real floor: "Neither
  // setAndAllowWhileIdle() nor setExactAndAllowWhileIdle() can fire alarms more than once per
  // nine minutes, per app" -- not the roughly-one-minute figure this comment used to claim. The
  // existing catch-up criterion (reconcile within the first hour of bridge reachability)
  // tolerates a nine-minute floor just as well, which is why no exact-alarm permission is
  // requested here. Whether the battery-optimization exemption (see
  // ForegroundSyncTickerModule's class doc) lifts this specific alarm quota was NOT verified on
  // device and must not be assumed.
  alarmManager.setAndAllowWhileIdle(
    AlarmManager.ELAPSED_REALTIME_WAKEUP,
    triggerAtElapsedMs,
    pendingIntent,
  )
}

/**
 * Cancels the pending tick alarm, if any, and the [PendingIntent] token it was armed with. Safe to
 * call even when none is currently armed.
 *
 * Both halves are required for [SyncTickerOwnership.ownsBackground] to answer correctly from every
 * process: the token is what the ownership query looks up, so an armed alarm whose token outlived
 * it would report "the ticker owns the background" forever, long past `stop()`.
 * [AlarmManager.cancel] still comes first, exactly as before -- cancelling the token alone does not
 * remove the already-scheduled alarm. The lookup is [PendingIntent.FLAG_NO_CREATE] so cancelling
 * never creates the token it is cancelling.
 */
internal fun cancelTickAlarm(context: Context) {
  val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
  val pendingIntent = findTickPendingIntent(context) ?: return
  alarmManager.cancel(pendingIntent)
  pendingIntent.cancel()
}

/**
 * Starts native ticking end-to-end (ODD native-foreground-sync-service T4): persists
 * [TickingState] with the given interval, arms the next tick alarm, then starts the sync-engine's
 * foreground service -- in that order, matching [TickAlarmReceiver]'s own "re-arm before starting
 * the service" rule, so a service-start refusal (see [startSyncForegroundServiceSafely]) never
 * costs the alarm either. Free of any [ForegroundSyncTickerModule] / `AppContext` dependency on
 * purpose, so it is testable with a plain Robolectric [Context], the same way every other
 * function in this file already is; the module's own `start()` is a thin wrapper around this.
 */
internal fun startSyncTicking(context: Context, intervalMs: Long) {
  persistTickingState(context, isTicking = true, intervalMs = intervalMs)
  scheduleNextTick(context, intervalMs)
  startSyncForegroundServiceSafely(context)
}

/**
 * Stops native ticking end-to-end: persists [TickingState] as not ticking, stops the sync-engine's
 * foreground service, then cancels the pending tick alarm. Safe to call with nothing currently
 * started or armed. The module's own `stop()` is a thin wrapper around this.
 */
internal fun stopSyncTicking(context: Context, intervalMs: Long) {
  persistTickingState(context, isTicking = false, intervalMs = intervalMs)
  stopSyncForegroundService(context)
  cancelTickAlarm(context)
}
