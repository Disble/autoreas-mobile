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
 * **Re-arms the alarm FIRST, always.** This is a pure `AlarmManager` call that needs no JS and no
 * live service, so it always happens here, on receipt, driven by the persisted [TickingState] --
 * never only from [ForegroundSyncTickerModule]'s own start/stop path. A receiver that only
 * re-armed from that path would die with the very first undelivered broadcast, which is the
 * `sent=0` defect this class originally existed to fix. Re-arming stays FIRST even now that this
 * receiver also starts the service below: if the service start throws, the alarm must already be
 * armed for the next interval, or the whole chain dies with it.
 *
 * **Then starts the sync-engine's foreground service (ODD native-foreground-sync-service T4).**
 * This reverses this class's own earlier design -- see "History" below: the receiver now owns
 * restoring the service, because Kotlin, not Notifee, owns it outright (T3's
 * `SyncForegroundService`). It is started by explicit intent naming the service by its
 * fully-qualified class name only, never by importing it -- see
 * [SYNC_FOREGROUND_SERVICE_CLASS_NAME]'s doc in `SyncForegroundServiceBridge.kt`:
 * `foreground-sync-ticker` and `sync-engine` are deliberately separate Gradle modules, and this
 * receiver must never gain a Gradle dependency on the one that owns the service.
 * Background/foreground-service starts are legal here because the app is on the user's
 * battery-optimization allowlist (verified on device, 2026-09-23); if the platform refuses anyway
 * (`ForegroundServiceStartNotAllowedException` on API 31+, e.g. if that exemption is later
 * revoked, or any other `IllegalStateException` / `SecurityException`),
 * [startSyncForegroundServiceSafely] logs a warning and swallows it -- degraded, never crashing,
 * and never at the cost of the alarm re-armed just above.
 *
 * Re-arming is conditional on [TickingState.isTicking], never unconditional. An unconditional
 * re-arm would keep waking the CPU every interval forever, even after `stop()` cleared the
 * persisted flag -- worse than the bug being fixed. `stopTicking()` in
 * [ForegroundSyncTickerModule] clears that flag specifically so this receiver has a way to stop
 * re-arming itself, and stops the service through the same `stopSyncForegroundService` this
 * receiver uses (via [startSyncForegroundServiceSafely]) to start it.
 *
 * **History.** This class used to dispatch `onTick` to a live [ForegroundSyncTickerModule]
 * instance (through its `activeInstance` companion property) so JS could run a cycle and hold a
 * per-tick wake lock, and deliberately did NOT try to restore the foreground service itself --
 * Notifee owned it then, through a JS API a bare `BroadcastReceiver` could not call, and reaching
 * into `app.notifee.core.ForegroundService` directly would have forked ownership of the service
 * between two layers. T4 retires both halves of that: Kotlin now owns the service outright (T3),
 * so there is no second owner to fork against, and the whole `onTick` dispatch / wake-lock path
 * is gone from this receiver and from [ForegroundSyncTickerModule] alike -- see that module's own
 * class doc for what stays on the JS-facing surface only for compatibility until T5.
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

      startSyncForegroundServiceSafely(context)
    } catch (error: Exception) {
      // Never let a tick failure escape onReceive: a crash here would take down whatever
      // process this receiver was woken into. startSyncForegroundServiceSafely already never
      // throws on its own, so this only guards readTickingState/scheduleNextTick.
      Log.w(RECEIVER_LOG_TAG, "tick alarm handling failed", error)
    }
  }
}
