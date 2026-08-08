package expo.modules.foregroundsyncticker

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val WAKE_LOCK_TAG = "ForegroundSyncTicker:ticking"

private const val THREAD_NAME = "ForegroundSyncTickerThread"

/**
 * Minimal native ticker: drives the FGS reconcile cadence from a HandlerThread that is not tied
 * to the host Activity lifecycle, so ticks keep firing while the app is backgrounded or the
 * screen is off.
 *
 * The PARTIAL_WAKE_LOCK is held for the entire ticking lifetime -- acquired in `startTicking`,
 * released in `stopTicking` -- and deliberately NOT per tick. `Handler.postDelayed` schedules
 * against `SystemClock.uptimeMillis()`, which stops advancing while the CPU is suspended, and a
 * foreground service grants process priority but no exemption from Doze CPU suspension. A per-tick
 * lock therefore left the remainder of every interval unprotected: the device slept, uptimeMillis
 * froze, and the next tick never fired with the screen off.
 *
 * The cost is explicit: continuous sync keeps the CPU awake for as long as it runs. That is what
 * the feature opts into, and the user can end it from the foreground-service notification.
 * Notifee remains the owner of the foreground service and its notification -- this module only
 * supplies the tick source.
 */
class ForegroundSyncTickerModule : Module() {
  private var handlerThread: HandlerThread? = null
  private var handler: Handler? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var intervalMs: Long = 15_000L
  private var isTicking = false

  private val tickRunnable = object : Runnable {
    override fun run() {
      if (!isTicking) {
        return
      }

      sendEvent("onTick", mapOf("firedAt" to SystemClock.elapsedRealtime()))

      handler?.postDelayed(this, intervalMs)
    }
  }

  private fun acquireTickingWakeLock() {
    val context = appContext.reactContext ?: return
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return

    releaseTickingWakeLock()

    val lock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
    // No timeout: the hold is bounded by stopTicking (and OnDestroy), not by a timer. A timeout
    // here would silently reintroduce the suspend gap this module exists to close.
    lock.acquire()
    wakeLock = lock
  }

  private fun releaseTickingWakeLock() {
    val heldLock = wakeLock
    if (heldLock != null && heldLock.isHeld) {
      heldLock.release()
    }
    wakeLock = null
  }

  private fun startTicking(nextIntervalMs: Long) {
    stopTicking()

    intervalMs = nextIntervalMs

    val thread = HandlerThread(THREAD_NAME)
    thread.start()

    handlerThread = thread
    handler = Handler(thread.looper)
    isTicking = true

    acquireTickingWakeLock()

    handler?.postDelayed(tickRunnable, intervalMs)
  }

  private fun stopTicking() {
    isTicking = false
    handler?.removeCallbacks(tickRunnable)
    handlerThread?.quitSafely()
    handlerThread = null
    handler = null
    releaseTickingWakeLock()
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

    OnDestroy {
      stopTicking()
    }
  }
}
