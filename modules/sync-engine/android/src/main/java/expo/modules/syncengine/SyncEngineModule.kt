package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

private const val LOG_TAG = "SyncEngine"

/**
 * The native background sync engine (ODD mobile-sync-native-engine T7 / architecture doc S6).
 *
 * One AsyncFunction, `runOnce(triggerSource)`, runs a WHOLE background attempt — read outbox →
 * claim → HTTP → map the wire response → stage into `pending_remote_changes` → advance cursor →
 * prune → journal — natively, so no JS timer participates in a background attempt and an attempt
 * can always end.
 *
 * The load-bearing guarantee is the BUDGET: `runOnce` always RESOLVES within
 * [ENGINE_BUDGET_MS] (30 s) of WALL-CLOCK time and never throws, never rejects. A
 * `null`/failed result is
 * acceptable; an unresolved promise is not, because an attempt that does not return is what
 * burns the platform's 600 s job budget. The guarantee is enforced by a NATIVE WATCHDOG that
 * lives on its own dedicated handler thread — not on the work executor, whose thread may be
 * parked inside a native call, and not on the JS thread. The deadline is measured on
 * `SystemClock.elapsedRealtime()`, the monotonic clock that KEEPS COUNTING while the device is
 * suspended, unlike `uptimeMillis()` which `Handler.postDelayed` uses for delivery (deep sleep
 * freezes `uptimeMillis`, so a bare `postDelayed(30s)` could be delivered far past 30 s of
 * wall clock). The callback still rides the handler's uptime clock — user-space code cannot
 * run while the CPU sleeps — but when it runs it re-checks the wall-clock deadline and fires
 * immediately once the budget has been exceeded in elapsed time; the budget never waits for
 * MORE uptime after it is already exceeded. If the watchdog thread cannot arm at all, the
 * attempt is refused and the refusal is traced in the journal (see below) — an unarmable
 * budget is never silent. At the budget the watchdog itself
 * writes the `abandoned` journal row (the worker cannot be trusted to report) and resolves the
 * pending promise with `outcome: "abandoned"` and the stage the attempt parked in. The work
 * thread may still finish its transaction afterwards; its terminal journal row simply arrives
 * after the watchdog's, which the journal's append-only history represents faithfully.
 * `Process.killProcess` is never called; the OS's own job stop remains the outer backstop.
 *
 * Deferred, documented as such (not silently skipped):
 * - the conflict-exhaustion policy (`conflict_attempt_count` caps and the token re-base) —
 *   conflicts fall back to the generic "reset to pending" retry;
 * - the diagnostics flush (`POST /api/sync/diagnostics`);
 * - `client_telemetry` beyond the minimal `{ cycle_id, trigger_source, counters }` envelope.
 *
 * The engine owns its OWN connection to the app database `autoreas.db` (same file expo-sqlite
 * uses, WAL already on) with `PRAGMA busy_timeout = 5000`, and performs each transaction with
 * `BEGIN IMMEDIATE` and a matching `COMMIT`/`ROLLBACK`. Its journal lives in the shared
 * `sync-journal.db` whose schema is OWNED by `modules/sync-journal`; see
 * {@link SyncEngineJournal} for the two-writers contract that T5 unifies.
 *
 * Observability contract: `runAttempt` logs a `Log.i` invocation line (trigger source and cycle
 * id) before anything else and a `Log.i` completion line on the worker's successful return, so
 * logcat can always tell an invocation that parked from pure silence.
 */
class SyncEngineModule : Module() {
  private val worker: ExecutorService = Executors.newSingleThreadExecutor()
  private val watchdogThread = HandlerThread(WATCHDOG_THREAD_NAME)
  private var watchdogHandler: Handler? = null
  private var appDb: SQLiteDatabase? = null
  private var journal: SyncEngineJournal? = null

  /** The last attempt state reached, readable by the watchdog from outside the parked worker. */
  private val lastState = AtomicReference("idle")

  init {
    watchdogThread.start()
    watchdogHandler = Handler(watchdogThread.looper)
  }

  override fun definition() = ModuleDefinition {
    Name("SyncEngine")

    AsyncFunction("runOnce") { triggerSource: String, promise: Promise ->
      runAttempt(triggerSource, promise)
    }

    OnDestroy {
      watchdogHandler?.removeCallbacksAndMessages(null)
      watchdogThread.quitSafely()
      worker.shutdown()
      try {
        appDb?.close()
      } catch (error: Throwable) {
        // The process is tearing the module down; a failed close has nothing left to report to.
      }
      appDb = null
      journal?.close()
      journal = null
    }
  }

  /**
   * Runs one attempt on the work executor, with the watchdog armed at the budget. Both
   * settlement paths are guarded by the attempt-local [settled] flag so the promise resolves
   * exactly once, and the watchdog callback is cleaned up on normal completion (and again in
   * `OnDestroy`). The flag is created per attempt, never at module level: two overlapping
   * `runOnce` invocations must not share one interlock, or the second invocation's reset can
   * invalidate the first's guard and leave its own promise unresolved past its budget.
   */
  private fun runAttempt(triggerSource: String, promise: Promise) {
    val cycleId = UUID.randomUUID().toString()
    val startMs = System.currentTimeMillis()

    // The invocation line fires before anything else so logcat distinguishes "runOnce was called
    // and then parked" from "runOnce was never invoked".
    Log.i(LOG_TAG, "runOnce invoked (triggerSource='$triggerSource', cycleId=$cycleId)")

    val context = appContext.reactContext

    if (context == null) {
      // No runtime to even open a database against: resolve, never reject or throw.
      promise.resolve(
        CycleOutcome("failed", "idle", 0, 0, "MissingReactContext").toMap(
          cycleId,
        ),
      )
      return
    }

    if (appDb == null) {
      appDb = openAppDatabase(context)
    }
    if (journal == null) {
      journal = SyncEngineJournal(context)
    }

    // The interlock is PER ATTEMPT: the watchdog and worker closures below capture this
    // instance, so overlapping invocations never share or reset each other's guard.
    val settled = AtomicBoolean(false)
    lastState.set("idle")

    // The deadline is absolute on the elapsedRealtime clock, which counts time spent in deep
    // sleep (SystemClock.elapsedRealtime(), available since API 1; the app targets SDK 35).
    val deadlineElapsedMs = SystemClock.elapsedRealtime() + ENGINE_BUDGET_MS
    val handler = watchdogHandler
    if (handler == null) {
      // The budget cannot be armed. Running the attempt without its watchdog would recreate
      // exactly the unresolved-promise hazard the watchdog exists to prevent, so the attempt
      // is refused and the refusal is traced in the journal with the existing vocabulary —
      // an unarmable budget must never be silent.
      Log.w(LOG_TAG, "attempt $cycleId refused: watchdog could not be armed")
      journal?.append(
        cycleId,
        lastState.get(),
        "abandoned",
        "watchdog could not be armed; attempt refused",
        System.currentTimeMillis(),
      )
      promise.resolve(CycleOutcome("abandoned", lastState.get(), 0, 0, null).toMap(cycleId))
      return
    }

    val watchdog = object : Runnable {
      override fun run() {
        // Delivery rides the handler's uptimeMillis clock, which freezes in deep sleep, so the
        // message can only be delivered once the CPU is awake — but possibly LONG after the
        // wall-clock budget passed. elapsedRealtime never stops, so the deadline comparison
        // catches that overshoot and fires immediately instead of waiting for more uptime.
        val remainingMs = deadlineElapsedMs - SystemClock.elapsedRealtime()
        if (remainingMs > 0) {
          // Defensive: uptime cannot outrun the elapsed deadline, so this branch should be
          // unreachable; re-arm for the remainder should the message ever fire early.
          handler.postDelayed(this, remainingMs)
          return
        }
        if (settled.compareAndSet(false, true)) {
          val stage = lastState.get()
          Log.w(LOG_TAG, "attempt $cycleId abandoned at stage '$stage' after ${ENGINE_BUDGET_MS}ms")
          // The watchdog owns the abandon record AND the resolution: the work thread may be
          // parked inside a native call and unable to report anything at all.
          journal?.append(
            cycleId,
            stage,
            "abandoned",
            "watchdog budget of ${ENGINE_BUDGET_MS}ms expired",
            System.currentTimeMillis(),
          )
          promise.resolve(CycleOutcome("abandoned", stage, 0, 0, null).toMap(cycleId))
        }
      }
    }

    handler.postDelayed(watchdog, ENGINE_BUDGET_MS)

    worker.execute {
      try {
        val cycle = SyncEngineCycle(appDb!!, journal!!)
        val outcome = cycle.run(triggerSource, cycleId, lastState::set)
        if (settled.compareAndSet(false, true)) {
          handler.removeCallbacks(watchdog)
          Log.i(
            LOG_TAG,
            "attempt $cycleId completed outcome='${outcome.outcome}' stage='${outcome.stage}' " +
              "in ${System.currentTimeMillis() - startMs}ms",
          )
          promise.resolve(outcome.toMap(cycleId))
        }
      } catch (error: Throwable) {
        // SyncEngineCycle never throws by contract; this guard only keeps an infrastructure
        // surprise from leaving the promise unresolved. It still names the failure.
        Log.w(LOG_TAG, "attempt $cycleId crashed", error)
        if (settled.compareAndSet(false, true)) {
          handler.removeCallbacks(watchdog)
          promise.resolve(
            CycleOutcome(
              "failed",
              lastState.get(),
              0,
              0,
              error.javaClass.simpleName,
            ).toMap(cycleId),
          )
        }
      }
    }
  }
}
