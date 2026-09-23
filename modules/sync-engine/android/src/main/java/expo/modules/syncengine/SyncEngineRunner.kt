package expo.modules.syncengine

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

private const val LOG_TAG = "SyncEngine"

/**
 * The native background sync engine's attempt runner (ODD mobile-sync-native-engine T7 /
 * architecture doc S6, relocated out of [SyncEngineModule] by ODD native-foreground-sync-service
 * T1). One attempt reads the outbox -> claims -> HTTP -> maps the wire response -> stages into
 * `pending_remote_changes` -> advances the cursor -> prunes -> journals, natively, so no JS timer
 * participates and an attempt can always end.
 *
 * This object needs only an [android.content.Context] (specifically `context.filesDir`), never a
 * React context: T1's whole point is that the attempt itself has no JS dependency, so it can be
 * driven by [SyncEngineModule] (a live React bridge call) today and by a plain foreground
 * service's worker thread (ODD native-foreground-sync-service T3) tomorrow, with neither caller
 * needing to know about the other.
 *
 * **Process-wide singleton, deliberately.** [worker] and the watchdog thread/handler are declared
 * ONCE here, not per caller, so the module and the future service are serialized through the SAME
 * single-thread executor and the SAME watchdog: two callers can never run two attempts at once,
 * which matters because both share the one SQLite cycle lease ([SyncCycleLease]) -- a second,
 * independent executor per caller would let two attempts race for that lease instead of queuing
 * behind each other. [appDb] and [journal] are opened once and kept for the process's lifetime for
 * the same reason: a foreground service is meant to keep running for hours, and reopening the
 * database or the journal between attempts would cost real time on every tick. Nothing tears these
 * down on a module's `OnDestroy` (see [SyncEngineModule]) -- only process death ends them, which is
 * correct for a background attempt runner that must keep working with no Activity attached.
 *
 * The load-bearing guarantee is the BUDGET: [runOnce] always calls [onResult] within
 * [ENGINE_BUDGET_MS] (30 s) of WALL-CLOCK time and never throws. A `failed`/`abandoned` result is
 * acceptable; a callback that never fires is not, because an attempt that does not return is what
 * burns the platform's 600 s job budget. The guarantee is enforced by a NATIVE WATCHDOG that lives
 * on its own dedicated handler thread -- not on [worker], whose thread may be parked inside a
 * native call, and not on the caller's thread. The deadline is measured on
 * `SystemClock.elapsedRealtime()`, the monotonic clock that KEEPS COUNTING while the device is
 * suspended, unlike `uptimeMillis()` which `Handler.postDelayed` uses for delivery (deep sleep
 * freezes `uptimeMillis`, so a bare `postDelayed(30s)` could be delivered far past 30 s of wall
 * clock). The callback still rides the handler's uptime clock -- user-space code cannot run while
 * the CPU sleeps -- but when it runs it re-checks the wall-clock deadline and fires immediately
 * once the budget has been exceeded in elapsed time; the budget never waits for MORE uptime after
 * it is already exceeded. If the watchdog thread cannot arm at all, the attempt is refused and the
 * refusal is traced in the journal -- an unarmable budget is never silent. At the budget the
 * watchdog itself writes the `abandoned` journal row (the worker cannot be trusted to report) and
 * calls [onResult] with `outcome: "abandoned"` and the stage the attempt parked in. The work
 * thread may still finish its transaction afterwards; its terminal journal row simply arrives
 * after the watchdog's, which the journal's append-only history represents faithfully.
 * `Process.killProcess` is never called; the OS's own job stop remains the outer backstop.
 *
 * **Presence gate (ODD native-foreground-sync-service T2 / T14 native half).** [runOnce] accepts
 * an optional `requirePresence` flag. When true, a cheap [SyncEngineBridgePresence] probe runs
 * BEFORE the watchdog is armed or the lease is touched; a failed probe returns immediately without
 * claiming ops, taking the lease, or writing a journal transition, logging one line instead. This
 * exists because the bridge is absent for roughly six hours every night (the device's own Wi-Fi
 * sleeps with it), and a foreground service that runs an attempt every tick regardless would pay a
 * real HTTP connect/lease/claim cost on every one of those ticks; the gate turns that into a
 * bounded probe (see [PRESENCE_PROBE_TIMEOUT_MS]) with no local writes. [SyncEngineModule]'s own
 * `runOnce` call always passes `requirePresence = false`: the existing JS-driven attempt policy
 * (`src/features/sync/attempt-policy.helpers.ts`) already gates in JS before ever reaching the
 * native module, so gating a second time here would only cost time without changing behavior. The
 * gate exists for ODD native-foreground-sync-service T3's service caller, which has no JS attempt
 * policy in front of it.
 *
 * **T3 fix: the probe's HTTP call runs on [worker], never on the caller's thread.**
 * [SyncForegroundService] calls [runOnce] from `onStartCommand`, which Android always invokes on
 * the MAIN thread; a synchronous HTTP call there would throw `NetworkOnMainThreadException`,
 * which [SyncEngineBridgePresence.probe]'s own `catch (Throwable)` would report as a plain
 * absence -- every gated attempt silently refused, with no trace of the real cause. So the probe
 * (and the cycle) run inside the [worker.execute] block below; [runOnce] itself only opens the
 * lazily-held db/journal and arms the watchdog (both fast, local, never network) before
 * submitting to [worker] and returning, regardless of caller thread.
 *
 * **The watchdog arms at ENQUEUE, on the caller's thread -- corrected after an earlier T3 attempt
 * got this backwards.** An earlier version of this fix armed the watchdog only once [worker]
 * actually started running the attempt, reasoning that a queued attempt's budget should not
 * count down while merely waiting in line. That reasoning is exactly backwards: the watchdog
 * exists FOR the case where [worker]'s thread is parked inside a native call (the class doc's own
 * "load-bearing guarantee" paragraph) -- and while parked, [worker] never reaches a SECOND queued
 * attempt's closure AT ALL, so a watchdog armed only inside that closure would never arm, and
 * [onResult] would never fire for it. That breaks the "[onResult] always fires within budget"
 * contract for BOTH of [runOnce]'s current callers: [SyncEngineModule]'s JS promise would never
 * resolve, and [SyncForegroundService]'s in-flight guard would stay true forever, silently
 * coalescing every later tick while its notification kept claiming sync was active. So the
 * watchdog is armed HERE, at enqueue, on the CALLER's thread (fast: computing a deadline and
 * calling `Handler.postDelayed` never touches the network or a lock worth worrying about) --
 * its budget covers the FULL span of queue wait + presence probe + cycle, exactly like the
 * design [SyncEngineModule]'s single JS caller already relied on before T1 extracted this class.
 * If the watchdog fires while an attempt is still queued, [worker] -- once it finally reaches
 * that attempt's closure -- finds [settled] already `true` and runs NEITHER the probe NOR the
 * cycle: the caller was already told `abandoned`, and starting a cycle afterward would be a
 * zombie writing to the lease/journal for an attempt nobody is waiting on anymore.
 *
 * Deferred, documented as such (not silently skipped):
 * - the conflict-exhaustion policy (`conflict_attempt_count` caps and the token re-base) --
 *   conflicts fall back to the generic "reset to pending" retry;
 * - the diagnostics flush (`POST /api/sync/diagnostics`);
 * - `client_telemetry` beyond the minimal `{ cycle_id, trigger_source, counters }` envelope.
 *
 * The engine owns its OWN connection to the app database `autoreas.db` (same file expo-sqlite
 * uses, WAL already on) with `PRAGMA busy_timeout = 5000`, and performs each transaction with
 * `BEGIN IMMEDIATE` and a matching `COMMIT`/`ROLLBACK`. Its journal lives in the shared
 * `sync-journal.db` whose schema is OWNED by `modules/sync-journal`; see [SyncEngineJournal] for
 * the two-writers contract that T5 unifies.
 *
 * Observability contract: a completion `Log.i` line fires on the worker's successful return
 * (naming outcome, stage, and elapsed time), a `Log.w` line fires on abandon/crash/unarmable-
 * watchdog, and a `Log.i` line fires on a presence refusal -- so logcat can always tell how an
 * attempt ended. [SyncEngineModule] itself still owns the very first "runOnce invoked" line: it
 * fires before this object is ever called, on the path where `appContext.reactContext` might be
 * null, so it cannot live here without duplicating it on that early-refusal path too.
 */
object SyncEngineRunner {
  private val worker: ExecutorService = Executors.newSingleThreadExecutor()
  private val watchdogThread = HandlerThread(WATCHDOG_THREAD_NAME)
  private var watchdogHandler: Handler? = null
  private var appDb: SQLiteDatabase? = null
  private var journal: SyncEngineJournal? = null

  /**
   * Test-only override for [ENGINE_BUDGET_MS], added by the ODD native-foreground-sync-service T3
   * testing pass so a test can force the watchdog to fire (combined with
   * [watchdogLooperForTest]'s virtual-clock advance) without waiting out the real 30 s production
   * budget. `null` (the default) leaves production behavior completely unchanged; only a test
   * that explicitly sets this ever sees a different budget. `internal` keeps it out of the public
   * API the module and the service call.
   */
  @Volatile
  internal var budgetMsOverrideForTest: Long? = null

  /** The budget this process actually runs under: [budgetMsOverrideForTest] in tests, else the
   * real [ENGINE_BUDGET_MS]. */
  private fun currentBudgetMs(): Long = budgetMsOverrideForTest ?: ENGINE_BUDGET_MS

  init {
    watchdogThread.start()
    watchdogHandler = Handler(watchdogThread.looper)
  }

  /**
   * Runs one attempt on [worker], with the watchdog armed at the budget, and calls [onResult]
   * exactly once with the terminal outcome. [context] only needs to answer `filesDir`; callers
   * should pass an application context (see [SyncEngineModule.runAttempt]) so this singleton
   * never outlives a caller-specific context.
   *
   * [cycleId] and [startMs] are minted by the caller (see [SyncEngineModule]) rather than here,
   * so a caller that needs to report a result BEFORE ever reaching this function (the
   * `MissingReactContext` refusal) can still use the same identifiers its own log line already
   * named.
   *
   * EVERY settlement path -- presence refused, completed, crashed, and abandoned -- goes through
   * `settled.compareAndSet(false, true)` before calling [onResult], and removes the watchdog
   * callback when it is the one that won that race. This is what keeps [onResult] firing EXACTLY
   * once even when the watchdog and the worker's own path both reach a terminal decision (the
   * watchdog fires while a presence probe already in flight has not yet returned, say): whichever
   * settles first wins, and the other becomes a no-op. The flag, the tracked stage, and the
   * watchdog itself are created PER ATTEMPT, never at object level: two overlapping attempts must
   * not share one interlock, or the second attempt's watchdog could be cancelled by the first's
   * cleanup and leave its own callback uncalled past its budget. [worker] being a single-thread
   * executor is what keeps [SyncEngineCycle.run] calls from ever running concurrently against the
   * shared lease; it does NOT, by itself, keep two watchdogs from being armed back to back --
   * exactly the property two independent callers (the module today, the foreground service from
   * T3) need, since each caller's own budget must cover its own full queue wait.
   */
  fun runOnce(
    context: Context,
    triggerSource: String,
    cycleId: String,
    startMs: Long,
    requirePresence: Boolean = false,
    onResult: (CycleOutcome) -> Unit,
  ) {
    // Opened once and kept for the process's lifetime (see the class doc): a steady-state
    // presence-refused tick below never repeats this open, it only reuses the already-live
    // connection. Synchronized so two near-simultaneous first callers cannot both race to open
    // the same file. This is the only work runOnce ever does on the CALLER's thread: it is local
    // file I/O, never network, so it is safe on a main-thread caller (SyncForegroundService).
    synchronized(this) {
      if (appDb == null) {
        appDb = openAppDatabase(context)
      }
      if (journal == null) {
        journal = SyncEngineJournal(context)
      }
    }
    val db = appDb!!
    val activeJournal = journal!!

    val handler = watchdogHandler
    if (handler == null) {
      // The budget mechanism itself is unavailable (the watchdog thread never got a looper).
      // This is checked up front, before ever touching worker or the presence gate, because no
      // attempt should be queued at all if its budget could never be armed -- an unarmable
      // budget must never be silent, and refusing here keeps that refusal on the same footing
      // (immediate, journaled) as before the T3 fix.
      Log.w(LOG_TAG, "attempt $cycleId refused: watchdog could not be armed")
      activeJournal.append(
        cycleId,
        "idle",
        "abandoned",
        "watchdog could not be armed; attempt refused",
        System.currentTimeMillis(),
      )
      onResult(CycleOutcome("abandoned", "idle", 0, 0, null))
      return
    }

    // The interlock and the tracked stage are PER ATTEMPT: fresh locals captured by the worker
    // and watchdog closures below, never shared object-level state -- shared state is exactly
    // what would let one caller's reset clobber another's in-flight stage.
    val settled = AtomicBoolean(false)
    val stageRef = AtomicReference("idle")

    // Armed HERE, at enqueue, on the CALLER's thread -- see the class doc's "the watchdog arms
    // at ENQUEUE" paragraph for why: the budget must cover the full span of queue wait +
    // presence probe + cycle, because worker may already be parked inside a native call for a
    // PRIOR attempt, in which case this attempt's own closure below never even starts. Arming
    // only computes a deadline and posts to a Handler -- fast, local, never network -- so doing
    // this on the caller's thread is safe even when the caller is a main-thread service.
    val budgetMs = currentBudgetMs()
    val deadlineElapsedMs = SystemClock.elapsedRealtime() + budgetMs
    val watchdog = object : Runnable {
      override fun run() {
        // Delivery rides the handler's uptimeMillis clock, which freezes in deep sleep, so the
        // message can only be delivered once the CPU is awake -- but possibly LONG after the
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
          val stage = stageRef.get()
          Log.w(LOG_TAG, "attempt $cycleId abandoned at stage '$stage' after ${budgetMs}ms")
          // The watchdog owns the abandon record AND the result: the work thread may be parked
          // inside a native call (or may not have started at all -- still queued behind a prior
          // attempt) and unable to report anything at all.
          activeJournal.append(
            cycleId,
            stage,
            "abandoned",
            "watchdog budget of ${budgetMs}ms expired",
            System.currentTimeMillis(),
          )
          onResult(CycleOutcome("abandoned", stage, 0, 0, null))
        }
      }
    }
    handler.postDelayed(watchdog, budgetMs)

    worker.execute {
      // If the watchdog already fired while this attempt was still queued (worker was parked
      // inside a prior attempt's native call for the whole budget), settled is already true:
      // neither the probe nor the cycle may run. The caller was already told `abandoned`, and a
      // cycle starting now would be a zombie -- claiming the lease and writing the journal for
      // an attempt nobody is waiting on anymore. No journal row is written here: the watchdog
      // already wrote the one and only row this attempt gets.
      if (settled.get()) {
        Log.w(LOG_TAG, "attempt $cycleId skipped: abandoned while queued")
        return@execute
      }

      try {
        // The presence gate's HTTP call runs HERE, on worker -- never on the caller's thread.
        // SyncForegroundService calls runOnce from onStartCommand (the main thread); a
        // synchronous HTTP call there would throw NetworkOnMainThreadException, which
        // SyncEngineBridgePresence.probe's own catch(Throwable) would silently report as
        // absence. Placed inside this try (unlike an earlier T3 attempt) so a database read
        // failure inside the probe cannot escape this closure and leave onResult uncalled.
        if (requirePresence) {
          val probe = SyncEngineBridgePresence.probe(db)
          if (!probe.isPresent) {
            // No claim, no lease touch, no journal write beyond what the watchdog may already
            // have written: the gate exists precisely to keep an absent-bridge tick this cheap
            // (see the class doc). `not_applicable` is the existing closed-vocabulary outcome
            // for "nothing was claimed"; errorName names the specific reason. Goes through the
            // SAME settled/removeCallbacks pair as every other settlement path: the watchdog may
            // have already fired while this exact HTTP call was still in flight, in which case
            // this CAS loses and onResult must NOT fire a second time.
            val elapsedMs = System.currentTimeMillis() - startMs
            Log.i(LOG_TAG, "presence refused (reason='${probe.reason}', elapsedMs=$elapsedMs)")
            if (settled.compareAndSet(false, true)) {
              handler.removeCallbacks(watchdog)
              onResult(CycleOutcome("not_applicable", "idle", 0, 0, "BridgePresenceRefused"))
            }
            return@execute
          }
        }

        val cycle = SyncEngineCycle(db, activeJournal)
        val outcome = cycle.run(triggerSource, cycleId, stageRef::set)
        if (settled.compareAndSet(false, true)) {
          handler.removeCallbacks(watchdog)
          Log.i(
            LOG_TAG,
            "attempt $cycleId completed outcome='${outcome.outcome}' stage='${outcome.stage}' " +
              "in ${System.currentTimeMillis() - startMs}ms",
          )
          onResult(outcome)
        }
      } catch (error: Throwable) {
        // SyncEngineCycle never throws by contract; this guard only keeps an infrastructure
        // surprise (including a probe/database failure outside SyncEngineCycle itself) from
        // leaving the callback uncalled. It still names the failure.
        Log.w(LOG_TAG, "attempt $cycleId crashed", error)
        if (settled.compareAndSet(false, true)) {
          handler.removeCallbacks(watchdog)
          onResult(
            CycleOutcome("failed", stageRef.get(), 0, 0, error.javaClass.simpleName),
          )
        }
      }
    }
  }

  /**
   * Test-only accessor for the watchdog's background [Looper] (ODD native-foreground-sync-service
   * T3 testing pass), so a test can deterministically force the watchdog to fire: this project's
   * Robolectric configuration runs `SystemClock` as a virtual clock even for a genuinely separate
   * background `HandlerThread`, so a `Handler.postDelayed` callback here never fires from real
   * wall-clock waiting alone (verified directly -- see [SyncEngineRunnerTest]'s class doc). A test
   * instead calls `org.robolectric.shadows.ShadowSystemClock.advanceBy(duration)` to move the
   * virtual clock forward and `org.robolectric.Shadows.shadowOf(watchdogLooperForTest()).
   * idleFor(duration)` to make THIS SPECIFIC looper process its now-due messages. `internal`
   * keeps it out of the public API the module and the service call.
   */
  internal fun watchdogLooperForTest(): Looper = watchdogThread.looper

  /**
   * Test-only reset, added by the ODD native-foreground-sync-service testing pass. Closes the
   * lazily opened [appDb]/[journal] handles and clears them so the NEXT [runOnce] call reopens
   * against whatever database file the calling test seeded, instead of silently reusing a
   * connection to a PRIOR test's file. This exists only because [SyncEngineRunner] is a
   * process-wide singleton BY DESIGN (see the class doc: one executor, one watchdog, one DB/
   * journal pair for the whole process, so the module and the future foreground service never
   * race two independent ones) — that guarantee is correct in production, where exactly one
   * process ever exists, but a test runner may or may not give each test method a fresh
   * classloader (and therefore a fresh copy of this `object`'s state), so tests must not rely on
   * either behavior. Calling this does not change [runOnce]'s production semantics in any way:
   * it only exists to make test order irrelevant. `internal` visibility keeps it out of the
   * public API the module and the service call.
   */
  internal fun resetForTest() {
    synchronized(this) {
      try {
        appDb?.close()
      } catch (error: Throwable) {
        // Best-effort: a close failure on a test fixture has nothing left to report to.
      }
      appDb = null
      journal?.close()
      journal = null
    }
    budgetMsOverrideForTest = null
  }
}
