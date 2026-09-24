package expo.modules.foregroundsyncticker

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

/** Log tag for a service-start failure this file must swallow, never let crash a caller. */
private const val BRIDGE_LOG_TAG = "SyncForegroundServiceBridge"

/**
 * Fully-qualified class name of the native foreground service that runs the sync attempt (ODD
 * native-foreground-sync-service T3), owned by `modules/sync-engine` -- a DIFFERENT Gradle module
 * this one must never take a Gradle dependency on (the feature's "Module placement" decision:
 * "the receiver starts the service by class name through an explicit intent, so the two Gradle
 * modules stay independent"). This string is the actual cross-module contract and must be kept in
 * sync, by hand, with `SyncForegroundService.SERVICE_CLASS_NAME` in
 * `modules/sync-engine/android/src/main/java/expo/modules/syncengine/SyncForegroundService.kt` --
 * a Kotlin class in one Gradle module cannot be imported from a different module that must stay
 * independent of it, the same way a JS config plugin cannot import a Kotlin class's constants.
 * Renaming or moving that class without updating this copy breaks the contract silently: the
 * intent built below simply resolves to nothing and the service never starts.
 */
internal const val SYNC_FOREGROUND_SERVICE_CLASS_NAME = "expo.modules.syncengine.SyncForegroundService"

/**
 * Intent action set on every start/stop intent this file builds, matching
 * `SyncForegroundService.ACTION_RUN_SYNC_ATTEMPT`. The service does not branch on it -- see that
 * class's own doc -- but it keeps a component started purely by class name self-describing in
 * logs and in `dumpsys activity services`.
 */
internal const val SYNC_FOREGROUND_SERVICE_ACTION = "expo.modules.syncengine.action.RUN_SYNC_ATTEMPT"

/**
 * Builds the explicit intent naming [SYNC_FOREGROUND_SERVICE_CLASS_NAME] by class name only,
 * never by importing the class -- see that constant's doc for why. Built in exactly this one
 * place so [defaultSyncForegroundServiceStarter] and [stopSyncForegroundService] never drift from
 * each other: a `stopService` call built from a differently-shaped intent would not match the
 * component the service was started with.
 */
private fun buildSyncForegroundServiceIntent(context: Context): Intent =
  Intent()
    .setClassName(context.packageName, SYNC_FOREGROUND_SERVICE_CLASS_NAME)
    .setAction(SYNC_FOREGROUND_SERVICE_ACTION)

/** The real starter [syncForegroundServiceStarter] defaults to outside tests. */
internal fun defaultSyncForegroundServiceStarter(context: Context) {
  ContextCompat.startForegroundService(context, buildSyncForegroundServiceIntent(context))
}

/**
 * Starts the sync-engine's foreground service by explicit intent. A mutable top-level seam,
 * rather than a direct [ContextCompat.startForegroundService] call at each use site, so tests
 * (ODD native-foreground-sync-service T4) can substitute a fake that throws: Robolectric has no
 * shadow that reproduces `ForegroundServiceStartNotAllowedException` (API 31+) or any other
 * platform refusal from a real `startForegroundService` call, so the only way to exercise
 * [startSyncForegroundServiceSafely]'s catch branch is to inject a throwing starter here. A test
 * that reassigns this must restore it (e.g. in `@After`) so it never leaks into another test.
 */
internal var syncForegroundServiceStarter: (Context) -> Unit = ::defaultSyncForegroundServiceStarter

/**
 * Starts the sync-engine's foreground service, never throwing. A background/foreground service
 * start can be refused by the platform (`ForegroundServiceStartNotAllowedException` on API 31+,
 * or another `IllegalStateException` / `SecurityException`, e.g. if the battery-optimization
 * exemption is later revoked); per the ODD native-foreground-sync-service Decisions, catching
 * that refusal and continuing degraded is this seam's job, shared by both of its callers
 * ([TickAlarmReceiver] and [startSyncTicking] in `TickAlarmScheduler.kt`) so neither repeats the
 * same swallow-and-log logic.
 */
internal fun startSyncForegroundServiceSafely(context: Context) {
  try {
    syncForegroundServiceStarter(context)
  } catch (error: Throwable) {
    Log.w(BRIDGE_LOG_TAG, "failed to start the sync foreground service", error)
  }
}

/**
 * Stops the sync-engine's foreground service by the same explicit-intent shape
 * [defaultSyncForegroundServiceStarter] uses. Safe to call whether or not the service is
 * currently running -- `stopService` on a component that is not running is a documented no-op.
 */
internal fun stopSyncForegroundService(context: Context) {
  context.stopService(buildSyncForegroundServiceIntent(context))
}
