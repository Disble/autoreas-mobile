package expo.modules.syncengine

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.testing.WorkManagerTestInitHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode
import java.util.concurrent.TimeUnit

/**
 * Stands in for the retired `expo-background-task` job's own WorkSpec: the legacy-cancellation
 * tests only need a periodic request scheduled under [LEGACY_EXPO_UNIQUE_WORK_NAME], and running a
 * real [SyncFloorWorker] there would execute an engine attempt unrelated to the property under
 * test.
 */
class RetiredExpoFloorTestWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result = Result.success()
}

/**
 * Robolectric tests for [SyncFloorScheduler] (ODD native-background-sync-cutover M2): the
 * idempotent registration surface M3 wires the foreground runtime to.
 *
 * These tests run against a REAL, test-initialized `WorkManager` rather than a fake, because the
 * property under test -- "registering twice keeps exactly ONE periodic request" -- is
 * `WorkManager`'s own unique-work guarantee, not something this module could fake without
 * restating it. [WorkManagerTestInitHelper] supplies synchronous executors, so
 * `enqueueUniquePeriodicWork` and `getWorkInfosForUniqueWork` are observable with no real
 * scheduler and no clock advancement.
 *
 * Every test starts from a cancelled unique-work name ([SyncFloorScheduler.unregister] in
 * [setUp]), and the unique name guarantees the WorkSpec list never holds more than one entry
 * whatever a previous test left behind: `cancelUniqueWork` transitions that one row to
 * `CANCELLED` instead of deleting it, which is exactly why registration is asserted through
 * [SyncFloorScheduler.status] -- and on the single-entry list -- instead of on raw
 * `ENQUEUED`/`RUNNING` states.
 *
 * `@SQLiteMode(NATIVE)` is required, exactly as it is for [SyncEngineRunnerTest]: the
 * test-initialized `WorkManager` persists its own Room database, and Robolectric's default
 * legacy SQLite shadow rejects the statements Room issues (observed: `IllegalStateException:
 * Illegal connection pointer`).
 *
 * The test scheduler deliberately runs an unconstrained worker as soon as it is enqueued, which
 * is why this file never asserts `ENQUEUED`: `TestScheduler` "brute-forces" unconstrained work
 * instead of waiting for a constraint or a delay, so the state right after registration is
 * `RUNNING` and the only stable, meaningful assertion is the registered/unregistered verdict
 * [SyncFloorScheduler.status] computes from the scheduled states.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncFloorSchedulerTest {

  private lateinit var context: Context
  private lateinit var workManager: WorkManager

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    // `WorkManager.initialize` is a process-wide singleton and throws when called twice, so the
    // test harness may or may not have initialized it already, depending on whether this
    // Robolectric sandbox was reused by an earlier test class.
    if (!WorkManager.isInitialized()) {
      WorkManagerTestInitHelper.initializeTestWorkManager(context)
    }
    workManager = WorkManager.getInstance(context)
    SyncFloorScheduler.unregister(context)
  }

  /** The unique work's single scheduled entry, whatever state it is in. */
  private fun workInfos(): List<WorkInfo> =
    workManager.getWorkInfosForUniqueWork(SYNC_FLOOR_UNIQUE_WORK_NAME).get()

  /** The retired Expo floor's entry under its own unique name, whatever state it is in. */
  private fun legacyWorkInfos(): List<WorkInfo> =
    workManager.getWorkInfosForUniqueWork(LEGACY_EXPO_UNIQUE_WORK_NAME).get()

  /** Schedules the pre-native floor exactly as `expo-background-task` did, under its real name. */
  private fun enqueueLegacyExpoWork() {
    workManager.enqueueUniquePeriodicWork(
      LEGACY_EXPO_UNIQUE_WORK_NAME,
      ExistingPeriodicWorkPolicy.KEEP,
      PeriodicWorkRequestBuilder<RetiredExpoFloorTestWorker>(15, TimeUnit.MINUTES).build(),
    ).result.get()
  }

  @Test
  fun `register enqueues one fifteen-minute periodic request for the floor worker`() {
    SyncFloorScheduler.register(context)

    val infos = workInfos()
    assertEquals("a unique periodic request is exactly one WorkSpec row", 1, infos.size)
    assertEquals(
      "the floor's interval is the platform's own periodic floor: 15 minutes",
      TimeUnit.MINUTES.toMillis(SYNC_FLOOR_INTERVAL_MINUTES),
      infos.single().periodicityInfo?.repeatIntervalMillis,
    )
    assertEquals("registered", SyncFloorScheduler.status(context).registrationStatus)
  }

  @Test
  fun `registering twice keeps exactly one periodic request`() {
    SyncFloorScheduler.register(context)
    SyncFloorScheduler.register(context)

    assertEquals("duplicate registration must not stack a second request", 1, workInfos().size)
    assertEquals("registered", SyncFloorScheduler.status(context).registrationStatus)
  }

  @Test
  fun `unregister cancels the request and reports an unregistered status`() {
    SyncFloorScheduler.register(context)

    SyncFloorScheduler.unregister(context)

    assertEquals(WorkInfo.State.CANCELLED, workInfos().single().state)
    assertEquals("unregistered", SyncFloorScheduler.status(context).registrationStatus)
  }

  @Test
  fun `status reports the registered floor and the ticker's background ownership`() {
    SyncFloorScheduler.register(context)

    val status = SyncFloorScheduler.status(context)

    assertEquals("registered", status.registrationStatus)
    assertTrue("the registered floor must be reported as the registered background task", status.isBackgroundTaskRegistered)
    assertFalse("nothing armed the ticker in this test, so it owns nothing", status.ownsBackground)
  }

  @Test
  fun `status reports an unregistered floor before anything is registered`() {
    val status = SyncFloorScheduler.status(context)

    assertEquals("unregistered", status.registrationStatus)
    assertFalse(status.isBackgroundTaskRegistered)
  }

  @Test
  fun `register cancels the legacy expo unique work once the native floor is confirmed`() {
    enqueueLegacyExpoWork()

    SyncFloorScheduler.register(context)

    assertEquals("registered", SyncFloorScheduler.status(context).registrationStatus)
    assertEquals(
      "a confirmed registration must retire the pre-native floor's scheduled request",
      WorkInfo.State.CANCELLED,
      legacyWorkInfos().single().state,
    )
  }

  @Test
  fun `registering twice keeps one native request and still retires the legacy expo unique work`() {
    enqueueLegacyExpoWork()

    SyncFloorScheduler.register(context)
    SyncFloorScheduler.register(context)

    assertEquals("duplicate registration must not stack a second request", 1, workInfos().size)
    assertEquals(
      WorkInfo.State.CANCELLED,
      legacyWorkInfos().single().state,
    )
  }

  @Test
  fun `register leaves the legacy expo unique work scheduled when the enqueue is not confirmed`() {
    enqueueLegacyExpoWork()

    val status = SyncFloorScheduler.register(context) { false }

    assertFalse(
      "an unconfirmed enqueue must not report a registered floor",
      status.isBackgroundTaskRegistered,
    )
    assertEquals("unregistered", status.registrationStatus)
    assertNotEquals(
      "an unconfirmed registration must never cancel the only floor this device has",
      WorkInfo.State.CANCELLED,
      legacyWorkInfos().single().state,
    )
  }

  @Test
  fun `register leaves the legacy expo unique work scheduled when the enqueue throws`() {
    enqueueLegacyExpoWork()

    assertThrows(IllegalStateException::class.java) {
      SyncFloorScheduler.register(context) { throw IllegalStateException("WorkManager unavailable") }
    }

    // The module adapter turns this throw into an `unsupported` payload; what matters here is that
    // the throw happened BEFORE the legacy cancellation, so the device keeps the floor it had.
    assertEquals("unregistered", SyncFloorScheduler.status(context).registrationStatus)
    assertNotEquals(
      WorkInfo.State.CANCELLED,
      legacyWorkInfos().single().state,
    )
  }

  @Test
  fun `unregister cancels both the native floor and the legacy expo unique work`() {
    SyncFloorScheduler.register(context)
    enqueueLegacyExpoWork()

    SyncFloorScheduler.unregister(context)

    assertEquals(WorkInfo.State.CANCELLED, workInfos().single().state)
    assertEquals(
      "disabling the runtime must retire the pre-native floor too, not only the native request",
      WorkInfo.State.CANCELLED,
      legacyWorkInfos().single().state,
    )
    assertEquals("unregistered", SyncFloorScheduler.status(context).registrationStatus)
  }
}
