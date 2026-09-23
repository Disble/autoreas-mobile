package expo.modules.foregroundsyncticker

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Native surface that keeps foreground sync alive: the `AlarmManager`-driven tick source, the
 * alarm re-arm, the battery-optimization exemption request, and the FGS presence check a
 * headless JS caller uses to decide whether to restore it.
 *
 * **Ownership of the foreground service itself (ODD native-foreground-sync-service, T3+T4).**
 * Kotlin owns the service outright now, through `modules/sync-engine`'s `SyncForegroundService`
 * -- a DIFFERENT Gradle module this one must never depend on. `start()`/`stop()` below start and
 * stop that service by explicit intent (see `SyncForegroundServiceBridge.kt` and
 * `TickAlarmScheduler.kt`'s `startSyncTicking`/`stopSyncTicking`), never by import, together with
 * arming/cancelling the alarm; [TickAlarmReceiver] does the same on every tick it receives while
 * ticking. Before T4, this module only dispatched `onTick` to JS and held a per-tick wake lock
 * scoped to the JS cycle promise; that entire path -- the event dispatch, the wake lock, and the
 * `activeInstance` companion [TickAlarmReceiver] used to dispatch through -- is retired. See
 * [TickAlarmReceiver]'s own "History" doc for the fuller before/after.
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
 * at all -- exactly the state a process kill leaves behind. So the alarm re-arm and the service
 * restart both live in the receiver, independent of whether a module instance is alive;
 * [reArmFromPersistedState] below only covers the alarm side of a fresh module instance created
 * after a process kill, so a lost broadcast costs at most one interval, not the whole cadence.
 *
 * **`Events("onTick")` and `notifyCycleComplete()` are kept, but now inert (T4).** Both remain
 * declared on the JS-facing surface below purely so the still-unmigrated JS callers
 * (`native-foreground-sync-ticker.helpers.ts`'s `addListener('onTick', ...)` and
 * `notifyCycleComplete()` call) keep working without a runtime error until T5 rewires them onto
 * the native FGS path directly. Nothing in this file calls `sendEvent` anymore, and
 * `notifyCycleComplete()` is a no-op: there is no more per-tick wake lock to release. T5 should
 * drop both, along with `ForegroundSyncTickListener`, `addListener`'s `'onTick'` overload, and
 * every caller of `notifyCycleComplete()` in `native-foreground-sync-ticker.helpers.ts` and the
 * Notifee adapter.
 *
 * The tick alarm is deliberately inexact: the system may batch or defer allow-while-idle alarms.
 * Android's Doze documentation states the floor is one delivery per NINE minutes, per app -- not
 * the roughly-one-minute figure this doc used to claim (see TickAlarmScheduler.kt's own comment
 * for the exact citation). The catch-up criterion (reconcile within the first hour of bridge
 * reachability) tolerates a nine-minute floor just as well, so the module still does not request
 * the exact-alarm special permission. Whether the battery-optimization exemption below actually
 * lifts that specific alarm quota was NOT verified on device and must not be assumed -- only
 * `getFgsAllowStart` flipping to `SYSTEM_ALLOW_LISTED` was confirmed, not the alarm floor itself.
 *
 * The battery-optimization exemption (`isIgnoringBatteryOptimizations` /
 * `requestIgnoreBatteryOptimizations`) is exemption #13 on Android's documented background-FGS-
 * start allow-list and the only one this app can reach: it is what flips `getFgsAllowStart` from
 * `DENIED` to `SYSTEM_ALLOW_LISTED` and, as a side effect, unlocks `setExactAndAllowWhileIdle`
 * without the separate `SCHEDULE_EXACT_ALARM` permission. It is requested, never assumed -- the
 * user grants it through the system dialog, and every caller here degrades honestly when it is
 * refused.
 *
 * `isForegroundServiceRunning` gives a headless JS caller the one signal it cannot otherwise
 * have: whether a foreground service matching the given notification channel id is ACTUALLY up
 * right now, in a fresh process with no live adapter instance to ask. It queries
 * `NotificationManager.getActiveNotifications()` for a match on that channel id -- an Android
 * foreground-service notification cannot outlive its service, the platform removes it the moment
 * the service stops, so this is a faithful proxy rather than a guess. It does not hardcode which
 * channel to check: the caller passes it, and as of T4 the one caller
 * (`foreground-service-watchdog.helpers.ts`) still passes Notifee's own channel id, not
 * `SyncForegroundService.CHANNEL_ID` -- a JS-side mismatch T5 needs to resolve, not a defect in
 * this function, which is unchanged by T4.
 * `ActivityManager.getRunningServices()` filtered to `app.notifee.core.ForegroundService` was
 * considered and rejected: it has been deprecated since API 26, and it would hardcode Notifee's
 * internal class name into this module, whereas the channel id is a constant this repo already
 * owns.
 */
class ForegroundSyncTickerModule : Module() {
  private var intervalMs: Long = 15_000L
  private var isTicking = false

  private fun startTicking(nextIntervalMs: Long) {
    stopTicking()

    intervalMs = nextIntervalMs
    isTicking = true

    val context = appContext.reactContext ?: return
    startSyncTicking(context, intervalMs)
  }

  private fun stopTicking() {
    isTicking = false

    val context = appContext.reactContext ?: return
    stopSyncTicking(context, intervalMs)
  }

  /**
   * Re-arms the next alarm from whatever ticking state survived process death, so a fresh module
   * instance -- created after the previous one was killed without `OnDestroy` ever running --
   * resumes the cadence instead of waiting on a broadcast that may never come. Idempotent:
   * [scheduleNextTick] reuses the same request-coded `PendingIntent` every time, so calling this
   * again only updates the trigger time, it never stacks a second alarm. Called from `OnCreate`,
   * so a lost broadcast costs at most one interval -- the next app open or headless wake -- not
   * the whole cadence. Alarm-only, deliberately: it does not also start the service, because the
   * tick alarm (via [TickAlarmReceiver]) is the guaranteed path that restores it without JS, and
   * duplicating a second service-start site here would fork that responsibility.
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
   * Answers whether a currently active notification belongs to [channelId] -- see the class doc
   * for why this is a faithful proxy for "is the foreground service actually running right now"
   * rather than a guess. Never throws: a missing context, a missing `NotificationManager`, a
   * platform below the API level that exposes notification channels, or any lookup failure all
   * resolve to `false` instead of propagating, matching every other status read in this module.
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

    // Kept only for JS-surface compatibility until T5 -- see the class doc's "Events(\"onTick\")
    // and notifyCycleComplete() are kept, but now inert" paragraph. Never emitted natively as of
    // T4: nothing in this file calls sendEvent anymore.
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

    // No-op as of T4: there is no more per-tick wake lock to release (see the class doc). Kept
    // so native-foreground-sync-ticker.helpers.ts's existing call site does not throw before T5
    // removes it.
    Function("notifyCycleComplete") {
      // intentionally empty
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
      reArmFromPersistedState()
    }

    OnDestroy {
      stopTicking()
    }
  }
}
