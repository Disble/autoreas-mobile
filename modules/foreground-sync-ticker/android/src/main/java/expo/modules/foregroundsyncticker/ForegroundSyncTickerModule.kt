package expo.modules.foregroundsyncticker

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val WAKE_LOCK_TAG = "ForegroundSyncTicker:tick"

// Bounded per-tick hold: long enough to cover one reconcile cycle, short enough that a stuck
// cycle cannot pin the CPU awake indefinitely (the system force-releases at this timeout).
private const val WAKE_LOCK_TIMEOUT_MS = 20_000L

private const val THREAD_NAME = "ForegroundSyncTickerThread"

/**
 * Minimal native ticker: drives the FGS reconcile cadence from a HandlerThread that is not tied
 * to the host Activity lifecycle, so ticks keep firing while the app is backgrounded or the
 * screen is off. Each tick briefly holds a PARTIAL_WAKE_LOCK so the JS-side reconcile cycle can
 * complete before Doze/App-Standby suspends CPU execution; the lock is released either explicitly
 * via `acknowledgeTick` (JS finished the cycle) or by the timeout above, whichever comes first.
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

      acquireTickWakeLock()
      sendEvent("onTick", mapOf("firedAt" to SystemClock.elapsedRealtime()))

      handler?.postDelayed(this, intervalMs)
    }
  }

  private fun acquireTickWakeLock() {
    val context = appContext.reactContext ?: return
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return

    releaseTickWakeLock()

    val lock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
    lock.acquire(WAKE_LOCK_TIMEOUT_MS)
    wakeLock = lock
  }

  private fun releaseTickWakeLock() {
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

    handler?.postDelayed(tickRunnable, intervalMs)
  }

  private fun stopTicking() {
    isTicking = false
    handler?.removeCallbacks(tickRunnable)
    handlerThread?.quitSafely()
    handlerThread = null
    handler = null
    releaseTickWakeLock()
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

    Function("acknowledgeTick") {
      releaseTickWakeLock()
    }

    Function("isRunning") {
      isTicking
    }

    OnDestroy {
      stopTicking()
    }
  }
}
