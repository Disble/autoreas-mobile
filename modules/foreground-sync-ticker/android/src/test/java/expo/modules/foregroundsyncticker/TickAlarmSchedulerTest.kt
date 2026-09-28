package expo.modules.foregroundsyncticker

import android.app.AlarmManager
import android.app.Application
import android.content.Context
import android.content.ContextWrapper
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * Robolectric tests for [startSyncTicking] and [stopSyncTicking] (ODD native-foreground-sync-
 * service T4) -- the free, context-only functions [ForegroundSyncTickerModule]'s `start()` and
 * `stop()` now delegate to. Testable with a plain Robolectric [Context], with no live `Module` /
 * `AppContext` needed, the same way every other function in `TickAlarmScheduler.kt` already is.
 */
@RunWith(RobolectricTestRunner::class)
class TickAlarmSchedulerTest {

  private val application: Application = ApplicationProvider.getApplicationContext()
  private val context: Context = application
  private val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  @Before
  fun setUp() {
    syncForegroundServiceStarter = ::defaultSyncForegroundServiceStarter
  }

  @After
  fun tearDown() {
    syncForegroundServiceStarter = ::defaultSyncForegroundServiceStarter
  }

  @Test
  fun `startSyncTicking persists ticking state, arms the alarm and starts the sync foreground service`() {
    startSyncTicking(context, intervalMs = 60_000L)

    val persisted = readTickingState(context)
    assertTrue("ticking state must be persisted as ticking", persisted.isTicking)
    assertEquals(60_000L, persisted.intervalMs)

    assertNotNull("the alarm must be armed", shadowOf(alarmManager).nextScheduledAlarm)

    val startedIntent = shadowOf(application).nextStartedService
    assertNotNull("the sync foreground service must be started", startedIntent)
    assertEquals(SYNC_FOREGROUND_SERVICE_CLASS_NAME, startedIntent!!.component?.className)
  }

  @Test
  fun `stopSyncTicking persists ticking state, stops the sync foreground service and cancels the alarm`() {
    startSyncTicking(context, intervalMs = 60_000L)
    // Drain the queue left by the start above so this test observes only stopSyncTicking's own
    // effect.
    shadowOf(application).nextStartedService

    stopSyncTicking(context, intervalMs = 60_000L)

    val persisted = readTickingState(context)
    assertFalse("ticking state must be persisted as not ticking", persisted.isTicking)

    assertNull("the alarm must be cancelled", shadowOf(alarmManager).nextScheduledAlarm)

    val stoppedIntent = shadowOf(application).nextStoppedService
    assertNotNull("the sync foreground service must be stopped", stoppedIntent)
    assertEquals(SYNC_FOREGROUND_SERVICE_CLASS_NAME, stoppedIntent!!.component?.className)
  }

  @Test
  fun `ownsBackground answers from the armed tick alarm token, not this process's persisted ticking flag`() {
    // The sync-engine's native floor may run in a second process (ODD native-background-sync-
    // cutover M2), and this process's SharedPreferences cache cannot answer for it: it is written
    // with `apply()` and is per-process. A process that never armed the ticker must answer "not
    // mine" for EVERY query (never a cached value) and must not create the token it asks about.
    assertFalse("a never-armed ticker owns nothing", SyncTickerOwnership.ownsBackground(context))
    assertFalse("asking again must stay false", SyncTickerOwnership.ownsBackground(context))
    assertNull("the ownership query must not arm anything", shadowOf(alarmManager).nextScheduledAlarm)

    startSyncTicking(context, intervalMs = 60_000L)

    // The switch must not move the source of the receiver's re-arm decision or the persisted
    // interval: they stay exactly what readTickingState already returned.
    val started = readTickingState(context)
    assertTrue("the persisted flag TickAlarmReceiver re-arms from must stay untouched", started.isTicking)
    assertEquals("start must keep persisting the interval unchanged", 60_000L, started.intervalMs)
    assertTrue("arming the ticker is what hands the background to it", SyncTickerOwnership.ownsBackground(context))
    // A different context instance -- the shape any other caller in this process has, and the
    // closest a unit test gets to the second process the floor is moving to -- must see the same
    // OS-level answer. A per-context or per-instance answer would be exactly the stale-cache bug.
    assertTrue(
      "the armed token must be found from any context, not just the arming one",
      SyncTickerOwnership.ownsBackground(ContextWrapper(context)),
    )

    stopSyncTicking(context, intervalMs = 60_000L)

    val stopped = readTickingState(context)
    assertFalse("the persisted flag must be cleared by stop, unchanged", stopped.isTicking)
    assertEquals("stop must keep persisting the interval unchanged", 60_000L, stopped.intervalMs)
    assertFalse("stopping the ticker must hand the background back", SyncTickerOwnership.ownsBackground(context))

    // The queries above left no token behind: a bare arm/cancel round trip still owns and then
    // releases the background exactly as it would with no prior ownership query.
    scheduleNextTick(context, delayMs = 60_000L)
    assertTrue("an armed token owns the background", SyncTickerOwnership.ownsBackground(context))

    cancelTickAlarm(context)
    assertFalse("a cancelled token must report not-owned from every process", SyncTickerOwnership.ownsBackground(context))
  }

  @Test
  fun `scheduling and cancelling degrade to no-ops when no alarm service is available`() {
    // Both functions guard on `getSystemService(ALARM_SERVICE) as? AlarmManager ?: return`, and
    // both are called unguarded from the manifest-declared receiver and from the JS-facing
    // module. A context without that platform service (a stripped-down context, or an OEM build
    // that reports none) must degrade to "nothing scheduled", never to a crash on the alarm path
    // -- which is exactly the branch the guard exists for. `getOrThrow()` makes the claim
    // explicit: any throwable fails this test with its own cause.
    shadowOf(application).setSystemService(Context.ALARM_SERVICE, null)

    runCatching {
      scheduleNextTick(context, delayMs = 60_000L)
      cancelTickAlarm(context)
    }.getOrThrow()
  }

  @Test
  fun `stopSyncTicking is safe to call when nothing was ever started`() {
    // Must not throw: stop() can be called from JS without a matching prior start() (e.g. a
    // double-stop, or a stop after a process restart with no persisted ticking state).
    stopSyncTicking(context, intervalMs = 60_000L)

    assertFalse(readTickingState(context).isTicking)
    assertNull(shadowOf(alarmManager).nextScheduledAlarm)
  }
}
