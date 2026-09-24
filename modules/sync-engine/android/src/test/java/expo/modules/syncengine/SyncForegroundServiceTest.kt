package expo.modules.syncengine

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowPowerManager
import org.robolectric.util.ReflectionHelpers
import java.util.concurrent.atomic.AtomicInteger

/**
 * Robolectric tests for [SyncForegroundService] (ODD native-foreground-sync-service T3),
 * exercised entirely against the injectable [SyncForegroundService.attemptRunner] seam so no test
 * here ever reaches [SyncEngineRunner]'s real SQLite-backed path (the known Robolectric UPSERT
 * limitation documented in [SyncEngineRunnerTest]'s class doc). Every scenario below drives the
 * fake runner synchronously through [RecordingAttemptRunner.resolve], so no thread, latch, or
 * timeout is needed anywhere in this file.
 */
@RunWith(RobolectricTestRunner::class)
class SyncForegroundServiceTest {

  /**
   * Fake [SyncAttemptRunner]: records every invocation's arguments and holds the `onResult`
   * callback open until the test explicitly [resolve]s it, so a test can assert "one attempt is
   * in flight" as a real, held-open state rather than a timing assumption.
   */
  private class RecordingAttemptRunner : (Context, String, String, Long, Boolean, (CycleOutcome) -> Unit) -> Unit {
    val invocationCount = AtomicInteger(0)

    @Volatile
    var lastTriggerSource: String? = null

    @Volatile
    var lastRequirePresence: Boolean? = null

    @Volatile
    private var pendingOnResult: ((CycleOutcome) -> Unit)? = null

    override fun invoke(
      context: Context,
      triggerSource: String,
      cycleId: String,
      startMs: Long,
      requirePresence: Boolean,
      onResult: (CycleOutcome) -> Unit,
    ) {
      invocationCount.incrementAndGet()
      lastTriggerSource = triggerSource
      lastRequirePresence = requirePresence
      pendingOnResult = onResult
    }

    /** Settles the most recent still-pending invocation with [outcome]. */
    fun resolve(outcome: CycleOutcome) {
      val onResult = pendingOnResult ?: error("no attempt is currently pending")
      pendingOnResult = null
      onResult(outcome)
    }
  }

  private fun newService(): SyncForegroundService =
    Robolectric.buildService(SyncForegroundService::class.java).create().get()

  private fun startCommand(service: SyncForegroundService, startId: Int = 1): Int {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val intent = Intent(context, SyncForegroundService::class.java)
    return service.onStartCommand(intent, 0, startId)
  }

  private fun foregroundServiceType(service: SyncForegroundService): Int =
    ReflectionHelpers.callInstanceMethod(shadowOf(service), "getForegroundServiceType")

  /** `ShadowPowerManager.ShadowWakeLock.isHeld()` is `protected` (Java visibility), which
   * Kotlin's stricter protected rules refuse to let a non-subclass call directly -- so this
   * reads it the same way [foregroundServiceType] reads its own protected shadow method. */
  private fun isWakeLockHeld(lock: android.os.PowerManager.WakeLock): Boolean =
    ReflectionHelpers.callInstanceMethod(shadowOf(lock), "isHeld")

  @Test
  fun `onStartCommand posts the specialUse foreground notification and starts one gated attempt`() {
    val service = newService()
    val runner = RecordingAttemptRunner()
    service.attemptRunner = runner

    val result = startCommand(service)

    assertEquals(Service.START_STICKY, result)

    val shadow = shadowOf(service)
    assertEquals(SyncForegroundService.NOTIFICATION_ID, shadow.lastForegroundNotificationId)
    assertEquals(SyncForegroundService.CHANNEL_ID, shadow.lastForegroundNotification.channelId)
    assertEquals(
      ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      foregroundServiceType(service),
    )

    assertEquals(1, runner.invocationCount.get())
    assertEquals(SyncForegroundService.TRIGGER_SOURCE, runner.lastTriggerSource)
    assertEquals(true, runner.lastRequirePresence)
  }

  @Test
  fun `the wake lock is held while the attempt is in flight and released on an abandoned outcome`() {
    val service = newService()
    val runner = RecordingAttemptRunner()
    service.attemptRunner = runner

    startCommand(service)

    val lock = ShadowPowerManager.getLatestWakeLock()
    assertTrue("the wake lock must be held while the attempt has not yet resolved", isWakeLockHeld(lock))
    assertEquals(SyncForegroundService.WAKE_LOCK_TAG, shadowOf(lock).tag)

    // "abandoned" is the watchdog's own outcome for an attempt that hit its budget -- the wake
    // lock must be released on it exactly as on any other terminal outcome (the class doc's
    // "released on the result, including abandoned and failed").
    runner.resolve(CycleOutcome("abandoned", "checked", 0, 0, null))

    assertFalse("the wake lock must be released once the attempt resolves", isWakeLockHeld(lock))
  }

  @Test
  fun `a start command while an attempt is in flight is coalesced into the running one`() {
    val service = newService()
    val runner = RecordingAttemptRunner()
    service.attemptRunner = runner

    val firstResult = startCommand(service, startId = 1)
    val secondResult = startCommand(service, startId = 2)

    assertEquals(Service.START_STICKY, firstResult)
    assertEquals(Service.START_STICKY, secondResult)
    assertEquals(
      "a start command received while an attempt is in flight must not start a second one",
      1,
      runner.invocationCount.get(),
    )

    // The coalesced call must still have kept the service in the foreground -- Android requires
    // startForeground on every start command, coalesced or not (see the class doc).
    assertEquals(SyncForegroundService.NOTIFICATION_ID, shadowOf(service).lastForegroundNotificationId)
  }

  @Test
  fun `once the in-flight attempt resolves, a later start command starts a new attempt`() {
    val service = newService()
    val runner = RecordingAttemptRunner()
    service.attemptRunner = runner

    startCommand(service, startId = 1)
    runner.resolve(CycleOutcome("not_applicable", "checked", 0, 0, null))

    startCommand(service, startId = 2)

    assertEquals(
      "coalescing must not permanently latch: a fresh start command after the prior attempt " +
        "settled must start its own attempt",
      2,
      runner.invocationCount.get(),
    )
  }

  @Test
  fun `a completed outcome is projected through the runtimeStatusWriter seam`() {
    val service = newService()
    val runner = RecordingAttemptRunner()
    service.attemptRunner = runner

    var recordedCycleId: String? = null
    var recordedAttemptedAtMs: Long? = null
    var recordedOutcome: CycleOutcome? = null
    service.runtimeStatusWriter = { _, cycleId, attemptedAtMs, outcome ->
      recordedCycleId = cycleId
      recordedAttemptedAtMs = attemptedAtMs
      recordedOutcome = outcome
    }

    startCommand(service)
    val outcome = CycleOutcome("closed", "closed", 3, 5, null)
    runner.resolve(outcome)

    assertEquals(outcome, recordedOutcome)
    assertTrue("a cycle id must have been recorded", !recordedCycleId.isNullOrBlank())
    assertTrue("the attempt start time must have been recorded", (recordedAttemptedAtMs ?: 0) > 0)
  }

  @Test
  fun `a runtimeStatusWriter failure still releases the wake lock and resets the in-flight guard`() {
    val service = newService()
    val runner = RecordingAttemptRunner()
    service.attemptRunner = runner
    service.runtimeStatusWriter = { _, _, _, _ -> throw RuntimeException("status write boom") }

    startCommand(service, startId = 1)
    val lock = ShadowPowerManager.getLatestWakeLock()

    // Must not throw out of the result callback: SyncForegroundService wraps the seam in its own
    // try/catch (ODD native-foreground-sync-service T6), on top of SyncEngineRuntimeStatus.record's
    // own "never throws" contract, precisely so an injectable failure here cannot escape.
    runner.resolve(CycleOutcome("closed", "closed", 1, 1, null))

    assertFalse(
      "the wake lock must be released even when the status projection throws",
      isWakeLockHeld(lock),
    )

    val secondResult = startCommand(service, startId = 2)
    assertEquals(Service.START_STICKY, secondResult)
    assertEquals(
      "the in-flight guard must have been reset so a later start command starts a new attempt",
      2,
      runner.invocationCount.get(),
    )
  }

  @Test
  fun `onDestroy releases a still-held wake lock defensively`() {
    val service = newService()
    val runner = RecordingAttemptRunner()
    service.attemptRunner = runner

    startCommand(service)
    val lock = ShadowPowerManager.getLatestWakeLock()
    assertTrue(isWakeLockHeld(lock))

    service.onDestroy()

    assertFalse(
      "a wake lock must never outlive its service, even if the attempt never reported back",
      isWakeLockHeld(lock),
    )
  }
}
