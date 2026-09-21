package expo.modules.foregroundsyncticker

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val WAKE_LOCK_TAG = "ForegroundSyncTicker:ticking"

private const val TICK_ALARM_ACTION = "expo.modules.foregroundsyncticker.TICK_ALARM"

private const val TICK_ALARM_REQUEST_CODE = 2001

/**
 * Safety net for the per-cycle wake lock: the primary bound is the JS cycle promise, reported
 * back through `notifyCycleComplete()`. If JS never reports completion (parked cycle, torn-down
 * runtime, removed listener) this timeout releases the lock so the CPU can sleep again. It is
 * deliberately much larger than a healthy cycle -- it bounds a hung cycle, it does not pace the
 * cadence, and it must not be tuned down to serve as the cycle budget.
 */
private const val CYCLE_WAKE_LOCK_TIMEOUT_MS = 120_000L

/**
 * Native ticker: drives the FGS reconcile cadence from `AlarmManager` instead of a `Handler`.
 * Ticks used to be scheduled with `Handler.postDelayed`, which measures delays against
 * `SystemClock.uptimeMillis()` -- a clock that stops advancing while the CPU is suspended. With
 * the screen off and no wake lock held between ticks, the pending delay froze and the next tick
 * never fired. Alarms of type `ELAPSED_REALTIME_WAKEUP` measure against
 * `SystemClock.elapsedRealtime()` (time since boot, including sleep) and wake the CPU to
 * deliver, so the cadence survives suspension without a permanently held wake lock.
 *
 * The `PARTIAL_WAKE_LOCK` is scoped to one dispatched cycle: acquired when a tick fires,
 * released when JS reports the cycle settled via `notifyCycleComplete()` (a rejection settles
 * too). The lock is reference counted, so one reference per dispatched tick balances one
 * release per reported cycle even when cycles overlap; `stop()` and `OnDestroy` drop every
 * remaining reference. The timeout is only a safety net for a cycle that never reports back.
 *
 * Notifee remains the owner of the foreground service and its notification -- this module only
 * supplies the tick source.
 *
 * The tick alarm is deliberately inexact: the system may batch or defer allow-while-idle alarms,
 * with a floor of roughly one delivery per minute and longer gaps in Doze. The catch-up criterion
 * (reconcile within the first hour of bridge reachability) tolerates that, so the module does
 * not request the exact-alarm special permission.
 */
class ForegroundSyncTickerModule : Module() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var intervalMs: Long = 15_000L
  private var isTicking = false
  private var isReceiverRegistered = false

  private val tickReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action != TICK_ALARM_ACTION) {
        return
      }
      dispatchTick()
    }
  }

  private fun dispatchTick() {
    if (!isTicking) {
      return
    }

    acquireCycleWakeLock()

    sendEvent("onTick", mapOf("firedAt" to SystemClock.elapsedRealtime()))

    scheduleNextTick(intervalMs)
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

  private fun registerTickReceiver() {
    if (isReceiverRegistered) {
      return
    }
    val context = appContext.reactContext ?: return

    val filter = IntentFilter(TICK_ALARM_ACTION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(tickReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(tickReceiver, filter)
    }
    isReceiverRegistered = true
  }

  private fun unregisterTickReceiver() {
    if (!isReceiverRegistered) {
      return
    }
    appContext.reactContext?.unregisterReceiver(tickReceiver)
    isReceiverRegistered = false
  }

  private fun buildTickPendingIntent(context: Context): PendingIntent {
    val intent = Intent(TICK_ALARM_ACTION).setPackage(context.packageName)
    return PendingIntent.getBroadcast(
      context,
      TICK_ALARM_REQUEST_CODE,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun scheduleNextTick(delayMs: Long) {
    val context = appContext.reactContext ?: return
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

  private fun cancelTickAlarm() {
    val context = appContext.reactContext ?: return
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    alarmManager.cancel(buildTickPendingIntent(context))
  }

  private fun startTicking(nextIntervalMs: Long) {
    stopTicking()

    intervalMs = nextIntervalMs
    isTicking = true

    registerTickReceiver()
    scheduleNextTick(intervalMs)
  }

  private fun stopTicking() {
    isTicking = false
    cancelTickAlarm()
    unregisterTickReceiver()
    releaseAllCycleWakeLocks()
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

    OnDestroy {
      stopTicking()
    }
  }
}
