package expo.modules.syncengine

import android.content.Context
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

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
 * Thin Expo bridge adapter over [SyncEngineRunner] (ODD mobile-sync-native-engine T7, relocated
 * by ODD native-foreground-sync-service T1). One `AsyncFunction`, `runOnce(triggerSource)`,
 * exposes the native background sync attempt to JS. Every part of the attempt itself --
 * database opening, the cycle lease, the watchdog, [SyncEngineCycle], the journal, and result
 * mapping -- lives in [SyncEngineRunner], which needs only a plain [android.content.Context];
 * this class's only remaining jobs are resolving that context from the React runtime, minting
 * the per-call `cycleId`, and mapping the runner's [CycleOutcome] onto the promise payload JS
 * already expects.
 *
 * The JS-visible contract is unchanged by this extraction: the same payload keys/values, the
 * same `runOnce invoked (...)` and completion log lines, and the same `MissingReactContext`
 * refusal when no context can be resolved at all.
 *
 * This module no longer owns a worker executor, a watchdog thread, or database/journal
 * connections -- [SyncEngineRunner] holds all of those as a process-wide singleton so the JS
 * caller here and the foreground service caller added by ODD native-foreground-sync-service T3
 * share the exact same executor, watchdog, and SQLite lease instead of racing two independent
 * ones. Consequently this module declares no `OnDestroy` teardown: those resources are meant to
 * outlive one module instance (a Fast Refresh reload, or the bridge tearing down while a
 * foreground service is still running attempts) and only end with the process itself.
 *
 * **The native floor's own surface (ODD native-background-sync-cutover M2, wired to JS by M3).**
 * `registerBackgroundSyncFloor()`, `unregisterBackgroundSyncFloor()` and
 * `getBackgroundSyncFloorStatus()` expose [SyncFloorScheduler] to JS, which M3 wires the
 * foreground runtime to, replacing the `expo-background-task` registration. All three resolve a
 * payload and NEVER reject -- the same "resolve, never reject or throw" contract `runOnce`
 * follows -- because a registration surface that can reject would force every M3 caller to wrap
 * it, and there is always an honest answer to give (`unsupported`).
 *
 * **M3 semantics.** `registerBackgroundSyncFloor()` resolves the status the registration LEFT
 * BEHIND, so a failed enqueue reports what is actually scheduled instead of a success; the Kotlin
 * scheduler cancels the pre-native `EXPO_BACKGROUND_WORKER` request only after WorkManager confirms
 * the new enqueue. `unregisterBackgroundSyncFloor()` cancels BOTH requests. The retired JS floor
 * (`expo-background-task`) is no longer registered from JS, so the JS floor is no longer the live
 * path; its files are removed in the next M3 work unit.
 */
class SyncEngineModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SyncEngine")

    AsyncFunction("runOnce") { triggerSource: String, promise: Promise ->
      runAttempt(triggerSource, promise)
    }

    AsyncFunction("registerBackgroundSyncFloor") { promise: Promise ->
      runFloorOperation(promise) { context -> SyncFloorScheduler.register(context) }
    }

    AsyncFunction("unregisterBackgroundSyncFloor") { promise: Promise ->
      runFloorOperation(promise) { context -> SyncFloorScheduler.unregister(context) }
    }

    AsyncFunction("getBackgroundSyncFloorStatus") { promise: Promise ->
      runFloorOperation(promise, action = null)
    }
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

  /**
   * Resolves a [android.content.Context] and hands the attempt to [SyncEngineRunner]. The
   * `cycleId` and the invocation log line stay here, ahead of the context resolution, so the
   * `MissingReactContext` refusal below -- which never reaches the runner -- still logs and
   * reports with the exact same shape as an attempt that does.
   */
  private fun runAttempt(triggerSource: String, promise: Promise) {
    val cycleId = UUID.randomUUID().toString()
    val startMs = System.currentTimeMillis()

    // The invocation line fires before anything else so logcat distinguishes "runOnce was called
    // and then parked" from "runOnce was never invoked".
    Log.i(LOG_TAG, "runOnce invoked (triggerSource='$triggerSource', cycleId=$cycleId)")

    // The runner only ever needs `filesDir`, so `.applicationContext` is deliberately preferred
    // over the live React context itself: it never ties the process-wide runner to an
    // Activity-scoped reference, and it is exactly the kind of plain context a future non-React
    // caller (the foreground service, ODD native-foreground-sync-service T3) will also pass.
    // `appContext.reactContext` remains the only thing that can be entirely absent (no runtime
    // attached yet, or one already torn down); once it exists, `.applicationContext` is
    // guaranteed non-null by the platform, so this preserves the exact same refusal condition
    // as before.
    val context = appContext.reactContext?.applicationContext

    if (context == null) {
      // No runtime to even open a database against: resolve, never reject or throw.
      promise.resolve(
        CycleOutcome("failed", "idle", 0, 0, "MissingReactContext").toMap(cycleId),
      )
      return
    }

    SyncEngineRunner.runOnce(context, triggerSource, cycleId, startMs) { outcome ->
      promise.resolve(outcome.toMap(cycleId))
    }
  }
}
