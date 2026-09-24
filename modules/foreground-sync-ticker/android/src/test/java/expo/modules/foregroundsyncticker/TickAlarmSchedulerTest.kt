package expo.modules.foregroundsyncticker

import android.app.AlarmManager
import android.app.Application
import android.content.Context
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
  fun `stopSyncTicking is safe to call when nothing was ever started`() {
    // Must not throw: stop() can be called from JS without a matching prior start() (e.g. a
    // double-stop, or a stop after a process restart with no persisted ticking state).
    stopSyncTicking(context, intervalMs = 60_000L)

    assertFalse(readTickingState(context).isTicking)
    assertNull(shadowOf(alarmManager).nextScheduledAlarm)
  }
}
