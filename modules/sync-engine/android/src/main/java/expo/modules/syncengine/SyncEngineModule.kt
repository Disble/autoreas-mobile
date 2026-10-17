package expo.modules.syncengine

import android.content.Context
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val LOG_TAG = "SyncEngine"

/**
 * The floor payload used when nothing native can answer: no React context (Expo Go, iOS, a
 * non-prebuilt binary) or a platform scheduler this process cannot reach. `unsupported` is the
 * existing `SyncRuntimeRegistrationStatus` member for exactly that answer, so a caller never has
 * to invent a fourth value.
 */
private val UNSUPPORTED_FLOOR_STATUS = SyncFloorStatus(
  registrationStatus = "unsupported",
  isBackgroundTaskRegistered = false,
  ownsBackground = false,
)

/**
 * Thin Expo bridge adapter for the native sync engine's JS-facing surface. JS never runs a sync
 * attempt (ADR 009 constraint 2): [SyncForegroundService] and [SyncFloorWorker] are the only
 * callers of [SyncEngineRunner], so this module exposes no attempt entry point -- and therefore no
 * JS call can open `autoreas.db` through the framework SQLite core.
 *
 * **The native floor's own surface (ODD native-background-sync-cutover M2, wired to JS by M3).**
 * `registerBackgroundSyncFloor()`, `unregisterBackgroundSyncFloor()` and
 * `getBackgroundSyncFloorStatus()` expose [SyncFloorScheduler] to JS, which M3 wires the
 * foreground runtime to, replacing the `expo-background-task` registration. All three resolve a
 * payload and NEVER reject, because a registration surface that can reject would force every
 * M3 caller to wrap it, and there is always an honest answer to give (`unsupported`).
 *
 * **M3 semantics.** `registerBackgroundSyncFloor()` resolves the status the registration LEFT
 * BEHIND, so a failed enqueue reports what is actually scheduled instead of a success; the Kotlin
 * scheduler cancels the pre-native `EXPO_BACKGROUND_WORKER` request only after WorkManager confirms
 * the new enqueue. `unregisterBackgroundSyncFloor()` cancels BOTH requests. The retired JS floor
 * (`expo-background-task`) is no longer registered from JS, so the JS floor is no longer the live
 * path; its files are removed in the next M3 work unit.
 *
 * **The reset's own surface (ODD mobile-database-recovery T5a).** `deleteAppDatabase()` exposes
 * [deleteAppDatabaseAndSidecars] to JS so the database reset deletes the app database TOGETHER
 * with its `-wal`/`-shm`/`-journal` sidecars through Android's SQLite API instead of expo-sqlite's
 * main-file-only delete. It opens no SQLite connection (see [runAppDatabaseDeletion]).
 */
class SyncEngineModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SyncEngine")

    AsyncFunction("registerBackgroundSyncFloor") { promise: Promise ->
      runFloorOperation(promise) { context -> SyncFloorScheduler.register(context) }
    }

    AsyncFunction("unregisterBackgroundSyncFloor") { promise: Promise ->
      runFloorOperation(promise) { context -> SyncFloorScheduler.unregister(context) }
    }

    AsyncFunction("getBackgroundSyncFloorStatus") { promise: Promise ->
      runFloorOperation(promise, action = null)
    }

    AsyncFunction("deleteAppDatabase") { promise: Promise ->
      runAppDatabaseDeletion(promise)
    }
  }

  /**
   * Deletes the app database and its SQLite sidecars through [deleteAppDatabaseAndSidecars],
   * resolving `{ deleted: boolean }`.
   *
   * Android's `SQLiteDatabase.deleteDatabase` opens NO connection -- it is a pure unlink of the database and
   * its sidecars -- so this call is safe exactly where JS runs, in the app's main process.
   *
   * It RESOLVES for every outcome and never rejects. An already-missing database is a legitimate
   * outcome of a resumed reset, so `deleted = false` is answered rather than refused, and the
   * payload carries one non-sensitive boolean -- never a path, a connection value, or a statement.
   * A missing React context cannot delete anything truthfully, so it answers `false` too; the JS
   * adapter is what decides whether the reset may proceed, by checking the filesystem afterwards.
   */
  private fun runAppDatabaseDeletion(promise: Promise) {
    val context = appContext.reactContext?.applicationContext
    if (context == null) {
      promise.resolve(mapOf("deleted" to false))
      return
    }

    promise.resolve(mapOf("deleted" to deleteAppDatabaseAndSidecars(context)))
  }

  /**
   * Resolves one floor payload: optionally performs [action] against the application context, then
   * reports the [SyncFloorStatus] that action RETURNED -- falling back to a fresh status read only
   * for the action-less status method. Never rejects and never throws (see the class doc);
   * `WorkManager.getInstance` throwing when the process has no initialized scheduler is the one real
   * failure this can hit, and it is reported as `unsupported` rather than swallowed.
   *
   * Taking the action's return value rather than re-reading the status is what makes the payload
   * honest: `register` must be able to answer "not registered" when its enqueue was not confirmed,
   * and a re-read could otherwise report a stale earlier request as this call's success.
   *
   * [SyncFloorScheduler.status] blocks on `WorkManager`'s own future, and Expo runs an
   * `AsyncFunction` on its own thread rather than the main thread, which is what makes that safe
   * here.
   */
  private fun runFloorOperation(promise: Promise, action: ((Context) -> SyncFloorStatus)?) {
    val context = appContext.reactContext?.applicationContext
    if (context == null) {
      promise.resolve(floorPayload(UNSUPPORTED_FLOOR_STATUS))
      return
    }

    try {
      val status = action?.invoke(context) ?: SyncFloorScheduler.status(context)
      promise.resolve(floorPayload(status))
    } catch (error: Throwable) {
      Log.w(LOG_TAG, "background sync floor operation failed", error)
      promise.resolve(floorPayload(UNSUPPORTED_FLOOR_STATUS))
    }
  }

  /**
   * The Expo-promise payload shape: the same field names the JS snapshot patch consumes
   * (`registrationStatus`, `isBackgroundTaskRegistered`) plus the floor's own ticker gate. Lives
   * HERE rather than on [SyncFloorStatus] because this adapter is INFRA -- the unit-test harness
   * cannot stand up an Expo runtime -- and a mapper in a gated class would be untestable coverage
   * debt.
   */
  private fun floorPayload(status: SyncFloorStatus): Map<String, Any?> = mapOf(
    "registrationStatus" to status.registrationStatus,
    "isBackgroundTaskRegistered" to status.isBackgroundTaskRegistered,
    "ownsBackground" to status.ownsBackground,
  )
}
