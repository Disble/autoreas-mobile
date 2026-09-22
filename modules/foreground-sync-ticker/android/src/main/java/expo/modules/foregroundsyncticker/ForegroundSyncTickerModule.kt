package expo.modules.foregroundsyncticker

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val WAKE_LOCK_TAG = "ForegroundSyncTicker:ticking"

/**
 * Safety net for the per-cycle wake lock: the primary bound is the JS cycle promise, reported
 * back through `notifyCycleComplete()`. If JS never reports completion (parked cycle, torn-down
 * runtime, removed listener) this timeout releases the lock so the CPU can sleep again. It is
 * deliberately much larger than a healthy cycle -- it bounds a hung cycle, it does not pace the
 * cadence, and it must not be tuned down to serve as the cycle budget.
 */
private const val CYCLE_WAKE_LOCK_TIMEOUT_MS = 120_000L

/**
 * Native surface that keeps foreground sync alive: the `AlarmManager`-driven tick source, the
 * alarm re-arm, the battery-optimization exemption request, and the FGS presence check a
 * headless JS caller uses to decide whether to restore it. Notifee remains the owner of the
 * foreground service and its notification -- this module supplies the mechanisms that keep that
 * service reachable and its cadence running, not the service itself.
 *
 * Ticks used to be scheduled with `Handler.postDelayed`, which measures delays against
 * `SystemClock.uptimeMillis()` -- a clock that stops advancing while the CPU is suspended. With
 * the screen off and no wake lock held between ticks, the pending delay froze and the next tick
 * never fired. Alarms of type `ELAPSED_REALTIME_WAKEUP` measure against
 * `SystemClock.elapsedRealtime()` (time since boot, including sleep) and wake the CPU to
 * deliver, so the cadence survives suspension without a permanently held wake lock.
 *
 * The alarm is delivered to [TickAlarmReceiver], a manifest-declared `BroadcastReceiver`
 * (declared in `plugins/withAndroidForegroundSync.js`, not in this module's own -- deliberately
 * empty -- `AndroidManifest.xml`). Android instantiates a manifest receiver with a plain
 * `Context` and no reference to this module, in a process that may have no React Native context
 * at all -- exactly the state a process kill leaves behind. A receiver registered on the React
 * context instead, as this module used to do, dies with that context while the alarm survives in
 * the system `AlarmManager` and fires into a void. So the responsibility is split: the receiver
 * re-arms the next alarm from persisted state on every delivery, whether or not a module instance
 * is alive; this module only dispatches `onTick` to JS, through [onAlarmReceived], and only when
 * [activeInstance] is set. A module instance registers itself in `OnCreate` and clears the
 * reference in `OnDestroy`, and also re-arms from persisted state at that point, so a fresh
 * instance created after a process kill resumes the cadence without waiting on a broadcast that
 * already fired into the previous, dead process.
 *
 * The `PARTIAL_WAKE_LOCK` is scoped to one dispatched cycle: acquired when a tick fires,
 * released when JS reports the cycle settled via `notifyCycleComplete()` (a rejection settles
 * too). The lock is reference counted, so one reference per dispatched tick balances one
 * release per reported cycle even when cycles overlap; `stop()` and `OnDestroy` drop every
 * remaining reference. The timeout is only a safety net for a cycle that never reports back.
 *
 * The tick alarm is deliberately inexact: the system may batch or defer allow-while-idle alarms,
 * with a floor of roughly one delivery per minute and longer gaps in Doze. The catch-up criterion
 * (reconcile within the first hour of bridge reachability) tolerates that, so the module does
 * not request the exact-alarm special permission.
 *
 * The battery-optimization exemption (`isIgnoringBatteryOptimizations` /
 * `requestIgnoreBatteryOptimizations`) is exemption #13 on Android's documented background-FGS-
 * start allow-list and the only one this app can reach: it is what flips `getFgsAllowStart` from
 * `DENIED` to `SYSTEM_ALLOW_LISTED` and, as a side effect, unlocks `setExactAndAllowWhileIdle`
 * without the separate `SCHEDULE_EXACT_ALARM` permission. It is requested, never assumed -- the
 * user grants it through the system dialog, and every caller here degrades honestly when it is
 * refused.
 *
 * `isForegroundServiceRunning` gives a headless JS caller (T4's watchdog) the one signal it
 * cannot otherwise have: whether the foreground service is ACTUALLY up right now, in a fresh
 * process with no live adapter instance to ask. It queries
 * `NotificationManager.getActiveNotifications()` for a match on the given channel id -- an
 * Android foreground-service notification cannot outlive its service, the platform removes it
 * the moment the service stops, so this is a faithful proxy rather than a guess.
 * `ActivityManager.getRunningServices()` filtered to `app.notifee.core.ForegroundService` was
 * considered and rejected: it has been deprecated since API 26, and it would hardcode Notifee's
 * internal class name into this module, whereas the channel id is a constant this repo already
 * owns.
 */
class ForegroundSyncTickerModule : Module() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var intervalMs: Long = 15_000L
  private var isTicking = false

  /**
   * Entry point [TickAlarmReceiver] calls when it finds a live module instance to deliver to.
   * The alarm's re-arm already happened in the receiver -- see its KDoc -- so this only reports
   * the tick to JS. Guarded by [isTicking] defensively: the receiver already checked the
   * persisted flag before dispatching here, but the in-memory flag is this alive instance's own
   * source of truth, e.g. if a tick lands mid-`stop()`.
   */
  internal fun onAlarmReceived() {
    if (!isTicking) {
      return
    }

    acquireCycleWakeLock()

    sendEvent("onTick", mapOf("firedAt" to SystemClock.elapsedRealtime()))
  }

  private fun acquireCycleWakeLock() {
    val context = appContext.reactContext ?: return
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return

    val lock = wakeLock ?: powerManager
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
      .also { created ->
        // Reference counted (the default) so overlapping dispatched cycles balance: each tick
        // acquires one reference and each `notifyCycleComplete()` releases one.
        created.setReferenceCounted(true)
        wakeLock = created
      }

    lock.acquire(CYCLE_WAKE_LOCK_TIMEOUT_MS)
  }

  private fun releaseCycleWakeLock() {
    val lock = wakeLock ?: return
    if (lock.isHeld) {
      lock.release()
    }
  }

  private fun releaseAllCycleWakeLocks() {
    val lock = wakeLock ?: return
    while (lock.isHeld) {
      lock.release()
    }
    wakeLock = null
  }

  private fun startTicking(nextIntervalMs: Long) {
    stopTicking()

    intervalMs = nextIntervalMs
    isTicking = true

    val context = appContext.reactContext ?: return
    persistTickingState(context, isTicking = true, intervalMs = intervalMs)
    scheduleNextTick(context, intervalMs)
  }

  private fun stopTicking() {
    isTicking = false
    releaseAllCycleWakeLocks()

    val context = appContext.reactContext ?: return
    persistTickingState(context, isTicking = false, intervalMs = intervalMs)
    cancelTickAlarm(context)
  }

  /**
   * Re-arms the next alarm from whatever ticking state survived process death, so a fresh module
   * instance -- created after the previous one was killed without `OnDestroy` ever running --
   * resumes the cadence instead of waiting on a broadcast that may never come. Idempotent:
   * [scheduleNextTick] reuses the same request-coded `PendingIntent` every time, so calling this
   * again only updates the trigger time, it never stacks a second alarm. Called from `OnCreate`,
   * so a lost broadcast costs at most one interval -- the next app open or headless wake -- not
   * the whole cadence.
   */
  private fun reArmFromPersistedState() {
    val context = appContext.reactContext ?: return
    val persisted = readTickingState(context)
    if (!persisted.isTicking) {
      return
    }

    intervalMs = persisted.intervalMs
    isTicking = true
    scheduleNextTick(context, intervalMs)
  }

  /**
   * Answers whether the app is currently exempt from Android's battery-optimization
   * restrictions (Doze / App Standby). Never throws: a missing context, a missing
   * `PowerManager` service, or a `SecurityException` from the platform all resolve to `false`
   * rather than propagating, because this is a status read, not a control-flow dependency.
   */
  private fun isIgnoringBatteryOptimizations(): Boolean {
    val context = appContext.reactContext ?: return false
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false

    return try {
      powerManager.isIgnoringBatteryOptimizations(context.packageName)
    } catch (error: SecurityException) {
      false
    }
  }

  /**
   * Fires the one-tap system dialog (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) that lets
   * the user grant this app the battery-optimization exemption. `FLAG_ACTIVITY_NEW_TASK` lets
   * the intent launch from a non-Activity context, which this module always is. Returns `false`
   * immediately when the app is already exempt -- there is nothing to request. Never throws: if
   * no activity can resolve the intent, or starting it throws for any reason (including a
   * `SecurityException` on OEM builds that block the action), this resolves to `false` instead
   * of propagating -- the caller degrades, it does not crash. The return value only reports
   * whether the dialog was launched, not whether the user granted it; callers re-read
   * `isIgnoringBatteryOptimizations()` to observe the outcome.
   *
   * Deliberately NOT guarded by `intent.resolveActivity(packageManager)`. That call is subject to
   * Android 11+ package-visibility filtering, and this app targets SDK 35, so without a `<queries>`
   * entry for this action it can return `null` for an intent `startActivity` would have resolved
   * fine. Pre-checking would therefore fail closed on exactly the devices the exemption matters
   * most on, and it would fail SILENTLY: the dialog would never show and this would report `false`
   * forever. Letting `startActivity` throw `ActivityNotFoundException` into the catch below yields
   * the same `false` for a genuinely absent activity, with no false negative.
   */
  private fun requestIgnoreBatteryOptimizations(): Boolean {
    if (isIgnoringBatteryOptimizations()) {
      return false
    }

    val context = appContext.reactContext ?: return false

    return try {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:${context.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

      context.startActivity(intent)
      true
    } catch (error: Exception) {
      false
    }
  }

  /**
   * Answers whether a currently active notification belongs to [channelId] -- today, that is the
   * FGS notification's own channel, so this is a faithful proxy for "is the foreground service
   * actually running right now" rather than a guess (see the class doc for why). Never throws: a
   * missing context, a missing `NotificationManager`, a platform below the API level that
   * exposes notification channels, or any lookup failure all resolve to `false` instead of
   * propagating, matching every other status read in this module.
   */
  private fun isForegroundServiceRunning(channelId: String): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return false
    }

    val context = appContext.reactContext ?: return false
    val notificationManager =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return false

    return try {
      notificationManager.activeNotifications.any { it.notification.channelId == channelId }
    } catch (error: Exception) {
      false
    }
  }

  override fun definition() = ModuleDefinition {
    Name("ForegroundSyncTicker")

    Events("onTick")

    Function("start") { intervalMillis: Double ->
      startTicking(intervalMillis.toLong())
    }

    Function("stop") {
      stopTicking()
    }

    Function("isRunning") {
      isTicking
    }

    Function("notifyCycleComplete") {
      releaseCycleWakeLock()
    }

    Function("isIgnoringBatteryOptimizations") {
      isIgnoringBatteryOptimizations()
    }

    Function("requestIgnoreBatteryOptimizations") {
      requestIgnoreBatteryOptimizations()
    }

    Function("isForegroundServiceRunning") { channelId: String ->
      isForegroundServiceRunning(channelId)
    }

    OnCreate {
      activeInstance = this@ForegroundSyncTickerModule
      reArmFromPersistedState()
    }

    OnDestroy {
      if (activeInstance === this@ForegroundSyncTickerModule) {
        activeInstance = null
      }
      stopTicking()
    }
  }

  companion object {
    /**
     * Live module instance [TickAlarmReceiver] dispatches ticks to, set in `OnCreate` and cleared
     * in `OnDestroy`. The clear is mandatory, not optional cleanup: a stale reference to a
     * destroyed module would leak the instance and dispatch a tick into a torn-down runtime. A
     * null reference is simply a no-op for the receiver's re-arm -- there is no JS to deliver to,
     * not an error condition.
     */
    @Volatile
    internal var activeInstance: ForegroundSyncTickerModule? = null
  }
}
