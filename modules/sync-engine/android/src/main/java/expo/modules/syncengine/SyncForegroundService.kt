package expo.modules.syncengine

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

private const val LOG_TAG = "SyncForegroundService"

/**
 * [SyncEngineRunner.runOnce]'s call shape, isolated into a type alias so [SyncForegroundService]
 * can accept an injectable fake in tests (ODD native-foreground-sync-service T3 testing pass)
 * without depending on the real SQLite-backed path -- Robolectric 4.14.1's bundled SQLite cannot
 * exercise a successful lease claim (see [SyncEngineRunnerTest]'s class doc), so service tests
 * need a seam that never reaches it.
 */
internal typealias SyncAttemptRunner =
  (Context, String, String, Long, Boolean, (CycleOutcome) -> Unit) -> Unit

/**
 * The Kotlin-owned foreground service that runs the native sync attempt (ODD
 * native-foreground-sync-service T3). This reverses the T2+T3 decision of
 * `background-service-multiday-survival.md` ("the receiver does not restore the FGS"): that
 * decision was right while Notifee owned the service, and the fix here is to move OWNERSHIP, not
 * to add a second owner alongside Notifee's `ForegroundService`. Notifee stops being started for
 * sync (T5 retires that call site); it stays in the project for any non-sync notification use.
 *
 * **Declared through the config plugin, not this module's own manifest.** No local Expo module in
 * this repo keeps a non-empty `AndroidManifest.xml` -- `foreground-sync-ticker`, `sync-engine` and
 * `sync-journal` all leave app-level manifest wiring to `plugins/withAndroidForegroundSync.js` --
 * so this service's `<service>` element, its `specialUse` type, its subtype property and its
 * permissions are declared there, following that convention.
 *
 * **Started by class name across a Gradle module boundary, deliberately.** T4's
 * `TickAlarmReceiver` lives in `modules/foreground-sync-ticker`, a DIFFERENT Gradle module that
 * must never gain a Gradle dependency on this one (see [SERVICE_CLASS_NAME]'s doc) -- so the
 * receiver builds an explicit `Intent` naming this class by its fully-qualified string, never by
 * importing it. [start] and [stop] below are for callers that DO hold a dependency on this
 * module (this module's own tests, or a future JS seam); the class-name string is the actual
 * cross-module contract.
 *
 * **One attempt per (non-coalesced) start command, serialized.** [SyncEngineRunner]'s own single-
 * thread `worker` already serializes every attempt process-wide, so two callers (this service and
 * [SyncEngineModule]) can never run two attempts at once regardless of this class. The
 * [attemptInFlight] guard here exists on top of that for a narrower reason: without it, a burst of
 * start commands (redundant ticks, a system redelivery) would each synchronously acquire its own
 * wake lock and enqueue its own attempt on [SyncEngineRunner]'s queue, piling up queued work and
 * wake locks that never overlap in execution but do pile up in acquisition. A coalesced start
 * command still calls [postForegroundNotification] (Android requires that promptly on every
 * `onStartCommand`, coalesced or not) but starts no new attempt and touches no wake lock.
 *
 * **The wake lock is per attempt, always released on the result -- including `abandoned` and
 * `failed`.** [SyncEngineRunner.runOnce]'s own watchdog guarantees [attemptRunner]'s `onResult`
 * fires exactly once within its budget and never throws, so the lock's own
 * [WAKE_LOCK_SAFETY_TIMEOUT_MS] is a defensive margin over that budget, not the real bound on how
 * long the lock can be held.
 *
 * **Never crashes the process.** [attemptRunner] is an injectable seam; this service does not
 * assume it upholds [SyncEngineRunner.runOnce]'s own "never throws" contract, so [startOneAttempt]
 * wraps the call and releases the wake lock and the in-flight guard on any exception.
 *
 * **Stays running once started.** This service does not call `stopSelf()` after an attempt
 * completes: the design (see the feature's "Why", the Syncthing shape) is a long-lived foreground
 * service that a tick alarm nudges into running one attempt every interval, not one that restarts
 * from scratch each time. [stop] -- an explicit, external call (T4/T5's job) -- is what ends it,
 * along with ordinary process death.
 */
class SyncForegroundService : Service() {

  /**
   * Swappable in tests (ODD native-foreground-sync-service T3 testing pass); defaults to the
   * real [SyncEngineRunner.runOnce]. `internal` so this module's own test source set can replace
   * it directly (no DI framework) without adding anything to this class's public API.
   */
  internal var attemptRunner: SyncAttemptRunner =
    { context, triggerSource, cycleId, startMs, requirePresence, onResult ->
      SyncEngineRunner.runOnce(context, triggerSource, cycleId, startMs, requirePresence, onResult)
    }

  /**
   * Swappable in tests (ODD native-foreground-sync-service T6), same reason and shape as
   * [attemptRunner]: defaults to the real [SyncEngineRuntimeStatus.record]. `internal` so this
   * module's own test source set can replace it with a throwing fake, to prove a status-write
   * failure never keeps [startOneAttempt] from releasing the wake lock or resetting
   * [attemptInFlight] (see the class doc's "never crashes the process" paragraph, which this
   * seam extends to the status projection).
   */
  internal var runtimeStatusWriter: (Context, String, Long, CycleOutcome) -> Unit =
    { context, cycleId, attemptedAtMs, outcome ->
      SyncEngineRuntimeStatus.record(context, cycleId, attemptedAtMs, outcome)
    }

  /** True while one attempt is in flight; see the class doc's coalescing paragraph. */
  private val attemptInFlight = AtomicBoolean(false)

  /** The wake lock held for the in-flight attempt, if any; released exactly once per attempt. */
  @Volatile
  private var heldWakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
  }

  /** Never bound: this service is only ever started, by [start] or by an explicit intent naming
   * [SERVICE_CLASS_NAME]. */
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Called first, before any other work, on EVERY start command -- including a coalesced one
    // (see the class doc) -- so Android 14+'s "call startForeground promptly" requirement is
    // always met regardless of whether this call ends up triggering a new attempt.
    postForegroundNotification()

    if (!attemptInFlight.compareAndSet(false, true)) {
      Log.i(LOG_TAG, "start command coalesced (startId=$startId): an attempt is already in flight")
      return START_STICKY
    }

    startOneAttempt(startId)
    return START_STICKY
  }

  override fun onDestroy() {
    // Defensive only: startOneAttempt's onResult callback always releases the lock it acquired,
    // so this only matters if the service is destroyed with one somehow still held -- a wake
    // lock must never outlive its service.
    releaseWakeLock()
    super.onDestroy()
  }

  /**
   * Runs exactly one native attempt through [attemptRunner], with `requirePresence = true` (this
   * service has no JS attempt policy in front of it -- see [SyncEngineBridgePresence]'s and
   * [SyncEngineRunner]'s class docs) and [TRIGGER_SOURCE] as the attempt's `triggerSource`.
   */
  private fun startOneAttempt(startId: Int) {
    val cycleId = UUID.randomUUID().toString()
    val startMs = System.currentTimeMillis()
    Log.i(LOG_TAG, "native fgs tick starting attempt (cycleId=$cycleId, startId=$startId)")

    acquireWakeLock()

    try {
      attemptRunner(applicationContext, TRIGGER_SOURCE, cycleId, startMs, true) { outcome ->
        // May run on SyncEngineRunner's worker or watchdog thread, never this service's own --
        // AtomicBoolean and PowerManager.WakeLock are both documented thread-safe, so no
        // marshaling back to the main thread is needed for correctness.
        Log.i(
          LOG_TAG,
          "native fgs tick attempt finished outcome='${outcome.outcome}' stage='${outcome.stage}' " +
            "(cycleId=$cycleId)",
        )
        try {
          // ODD native-foreground-sync-service T6: projects this attempt's outcome into
          // sync_runtime_status so Settings stops showing stale values for the native FGS path.
          // SyncEngineRuntimeStatus.record never throws by contract, but this seam is injectable
          // (a test fake, or a future caller that does not honor that contract), so the wake
          // lock release and the in-flight reset below must survive it regardless.
          runtimeStatusWriter(applicationContext, cycleId, startMs, outcome)
        } catch (error: Throwable) {
          Log.w(LOG_TAG, "status projection crashed (cycleId=$cycleId)", error)
        }
        releaseWakeLock()
        attemptInFlight.set(false)
      }
    } catch (error: Throwable) {
      // SyncEngineRunner.runOnce never throws by contract, but attemptRunner is an injectable
      // seam and this service must survive a caller/fake that does not honor that contract --
      // see the class doc's "never crashes the process" paragraph.
      Log.w(LOG_TAG, "attempt crashed before completion (cycleId=$cycleId)", error)
      releaseWakeLock()
      attemptInFlight.set(false)
    }
  }

  private fun acquireWakeLock() {
    val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
    if (powerManager == null) {
      Log.w(LOG_TAG, "no PowerManager available; attempt runs without a wake lock")
      return
    }
    val lock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
    // Safety bound, not the attempt's real budget (see the class doc): SyncEngineRunner's own
    // watchdog already guarantees a result within ENGINE_BUDGET_MS, so this only protects
    // against the lock itself outliving a caller that somehow never delivers a callback at all.
    lock.acquire(WAKE_LOCK_SAFETY_TIMEOUT_MS)
    heldWakeLock = lock
  }

  private fun releaseWakeLock() {
    val lock = heldWakeLock ?: return
    heldWakeLock = null
    if (lock.isHeld) {
      lock.release()
    }
  }

  /** Creates this service's own notification channel, idempotently; a no-op below API 26, where
   * channels do not exist. */
  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val notificationManager =
      getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    notificationManager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW),
    )
  }

  /**
   * Builds and posts the ongoing notification and promotes this service to the foreground with
   * [ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE] -- required on API 34+, and handled as a
   * safe no-op-of-the-type-argument on older platforms by [ServiceCompat.startForeground] itself,
   * so no manual `Build.VERSION.SDK_INT` branch is needed here. Title/body copy matches the
   * Notifee adapter's own foreground notification (`notifee-foreground-service-adapter.helpers.ts`)
   * so the user sees continuity even though a different owner is now posting it.
   */
  private fun postForegroundNotification() {
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(NOTIFICATION_TITLE)
      .setContentText(NOTIFICATION_BODY)
      .setSmallIcon(smallIconResId())
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      notification,
      ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
    )
  }

  /** The app's own launcher icon, resolved at runtime so this module needs no `res/drawable` of
   * its own; falls back to a public platform icon on the (practically unreachable) chance the
   * app's own icon resource is unset. */
  private fun smallIconResId(): Int {
    val appIcon = applicationInfo.icon
    return if (appIcon != 0) appIcon else android.R.drawable.ic_dialog_info
  }

  companion object {
    /** [SyncEngineRunner.runOnce]'s `triggerSource` for every attempt this service starts. */
    internal const val TRIGGER_SOURCE = "native_fgs_tick"

    /**
     * Stable, fully-qualified name of this class -- the actual cross-module contract T4's
     * `TickAlarmReceiver` (a DIFFERENT Gradle module, `foreground-sync-ticker`, which must never
     * gain a Gradle dependency on this one; see the class doc) depends on. That receiver builds
     * an explicit `Intent` naming this exact string as the component class
     * (`Intent().setClassName(packageName, "expo.modules.syncengine.SyncForegroundService")`),
     * never by importing this class. Renaming or moving this class without updating every
     * hardcoded copy of this string breaks the contract silently: the intent simply resolves to
     * nothing and the service never starts.
     */
    const val SERVICE_CLASS_NAME = "expo.modules.syncengine.SyncForegroundService"

    /**
     * Intent action a caller building the start intent by class name (see [SERVICE_CLASS_NAME])
     * should set. [onStartCommand] does not branch on it -- every start command triggers an
     * attempt, subject only to the coalescing described in the class doc, regardless of action,
     * including a `null` intent from a `START_STICKY` system restart -- but it is documented and
     * required so a component started by class name alone stays self-describing in logs and in
     * `dumpsys activity services`.
     */
    const val ACTION_RUN_SYNC_ATTEMPT = "expo.modules.syncengine.action.RUN_SYNC_ATTEMPT"

    // internal, not private: the ODD native-foreground-sync-service T3 test suite asserts these
    // exact values (channel id, notification id/copy, wake lock tag) rather than duplicating them
    // as separate literals a production edit could silently drift away from.
    internal const val CHANNEL_ID = "autoreas-sync-foreground-native"
    internal const val CHANNEL_NAME = "Sync continuo"
    internal const val NOTIFICATION_ID = 4821
    internal const val NOTIFICATION_TITLE = "Sync continuo activo"
    internal const val NOTIFICATION_BODY =
      "Autoreas mantiene la sincronización activa en segundo plano."
    internal const val WAKE_LOCK_TAG = "SyncEngine:nativeForegroundServiceAttempt"

    /** Margin over [ENGINE_BUDGET_MS] (defined in `SyncEngineDatabases.kt`, same package): see
     * [acquireWakeLock]'s doc for why this is a safety bound, not the attempt's real budget. */
    private const val WAKE_LOCK_SAFETY_TIMEOUT_MS = ENGINE_BUDGET_MS + 5_000L

    /**
     * Starts (or, if already running, redelivers a start command to) this service through an
     * explicit intent -- the same shape a caller without a Gradle dependency on this module must
     * build by class name (see [SERVICE_CLASS_NAME]). Provided for callers that DO hold one (this
     * module's own tests, or a future JS seam). May throw
     * `android.app.ForegroundServiceStartNotAllowedException` (API 31+) when the process is not
     * allowed to start a foreground service from the background; per the ODD
     * native-foreground-sync-service Decisions, catching that and keeping the tick alarm armed is
     * the CALLER's responsibility (T4's receiver), so it is deliberately not swallowed here.
     */
    fun start(context: Context) {
      val intent = Intent(context, SyncForegroundService::class.java)
        .setAction(ACTION_RUN_SYNC_ATTEMPT)
      ContextCompat.startForegroundService(context, intent)
    }

    /** Stops the service. Safe to call whether or not it is currently running. */
    fun stop(context: Context) {
      context.stopService(Intent(context, SyncForegroundService::class.java))
    }
  }
}
