package expo.modules.foregroundsyncticker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Log tag for failures this receiver must swallow rather than let propagate out of `onReceive`. */
private const val RESTART_RECEIVER_LOG_TAG = "SyncRestartReceiver"

/** System broadcasts after which the sync foreground service and the tick alarm are gone. */
private val RESTART_ACTIONS = setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)

/**
 * Brings background sync back after a reboot or an app update. Both clear the tick alarm and kill
 * the sync foreground service, and before this receiver nothing restarted them until the user
 * opened the app; only the 15-minute WorkManager floor synced in the meantime (reboot test,
 * 2026-11-14, `odd/tasks/sync-background-cleanup.md` L2).
 *
 * Declared in `plugins/withAndroidForegroundSync.js`, in the main process like
 * [TickAlarmReceiver], because the ticking state it reads has its single writer there. Starting
 * the service from `BOOT_COMPLETED` is allowed for its `specialUse` type: Android 15 forbids only
 * `dataSync`, `camera`, `mediaPlayback`, `phoneCall`, `mediaProjection` and `microphone` there.
 */
class SyncRestartReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context?, intent: Intent?) {
    if (context == null || intent?.action !in RESTART_ACTIONS) {
      return
    }

    restoreBackgroundSync(context, RESTART_RECEIVER_LOG_TAG)
  }
}
