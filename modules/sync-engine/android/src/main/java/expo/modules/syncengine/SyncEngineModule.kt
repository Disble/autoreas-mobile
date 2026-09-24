package expo.modules.syncengine

import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

private const val LOG_TAG = "SyncEngine"

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
 */
class SyncEngineModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SyncEngine")

    AsyncFunction("runOnce") { triggerSource: String, promise: Promise ->
      runAttempt(triggerSource, promise)
    }
  }

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
