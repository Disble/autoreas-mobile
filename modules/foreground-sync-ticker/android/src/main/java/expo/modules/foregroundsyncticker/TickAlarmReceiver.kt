package expo.modules.foregroundsyncticker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** Log tag for failures this receiver must swallow rather than let propagate out of `onReceive`. */
private const val RECEIVER_LOG_TAG = "TickAlarmReceiver"

/**
 * Manifest-declared receiver for the tick alarm, declared in `plugins/withAndroidForegroundSync.js`
 * (`mainApplication.receiver`) rather than in this module's own -- deliberately empty --
 * `AndroidManifest.xml`; see that plugin for why every app-level manifest edit for this feature
 * goes through it. Android instantiates this class with a plain [Context] and no reference to
 * [ForegroundSyncTickerModule], in a process that may have no React Native context at all: that is
 * exactly the state a process kill, or an undelivered broadcast, leaves behind -- the state a
 * context-registered receiver cannot survive, because it is torn down with the React context it
 * was registered on while the alarm itself keeps living in the system `AlarmManager`.
 *
 * The responsibility here is split on purpose, and only half of it is this receiver's:
 * - **Re-arming the next alarm** is a pure `AlarmManager` call that needs no JS, so it always
 *   happens here, on receipt, driven by the persisted [TickingState] -- never only from
 *   [ForegroundSyncTickerModule]'s delivery path. A receiver that only re-armed from the delivery
 *   path would die with the very first undelivered broadcast, which is the `sent=0` defect this
 *   class exists to fix.
 * - **Dispatching `onTick` to JS** needs a live module instance, so it only happens when
 *   [ForegroundSyncTickerModule.activeInstance] is non-null. A null instance is a no-op re-arm,
 *   not an error -- the process may have been woken for this alarm alone, with no JS ever started.
 *
 * Re-arming is conditional on [TickingState.isTicking], never unconditional. An unconditional
 * re-arm would keep waking the CPU every interval forever, even after `stop()` cleared the
 * persisted flag -- worse than the bug being fixed. `stopTicking()` in
 * [ForegroundSyncTickerModule] clears that flag specifically so this receiver has a way to stop
 * re-arming itself.
 *
 * This receiver deliberately does not try to restore the foreground service. Notifee owns the FGS
 * and its notification through a JS API (`adapter.register()`) that a bare `BroadcastReceiver` in
 * a process with no React Native context cannot call; reaching for
 * `app.notifee.core.ForegroundService` directly from Kotlin would fork ownership of the service
 * between two layers -- exactly the kind of second wiring location this feature's design
 * deliberately avoids elsewhere. Restoring the FGS from the background is a JS-path watchdog's
 * job, not this receiver's.
 */
class TickAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context?, intent: Intent?) {
    if (context == null || intent?.action != TICK_ALARM_ACTION) {
      return
    }

    try {
      val tickingState = readTickingState(context)
      if (!tickingState.isTicking) {
        return
      }

      scheduleNextTick(context, tickingState.intervalMs)

      ForegroundSyncTickerModule.activeInstance?.onAlarmReceived()
    } catch (error: Exception) {
      // Never let a tick failure escape onReceive: a crash here would take down whatever
      // process this receiver was woken into, whether or not a module instance was alive.
      Log.w(RECEIVER_LOG_TAG, "tick alarm handling failed", error)
    }
  }
}
