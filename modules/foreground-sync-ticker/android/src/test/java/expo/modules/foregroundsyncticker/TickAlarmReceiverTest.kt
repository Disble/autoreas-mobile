package expo.modules.foregroundsyncticker

import android.app.AlarmManager
import android.app.Application
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * Robolectric tests for [TickAlarmReceiver] (ODD native-foreground-sync-service T4). Exercises
 * the receiver through a plain [Context] -- never through a live [ForegroundSyncTickerModule] --
 * matching how Android itself instantiates a manifest-declared receiver (see that class's own
 * doc). [syncForegroundServiceStarter] is reset before and after every test so no test leaks a
 * fake into another.
 */
@RunWith(RobolectricTestRunner::class)
class TickAlarmReceiverTest {

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

  private fun tickIntent(): Intent = Intent(TICK_ALARM_ACTION)

  @Test
  fun `onReceive while ticking re-arms the alarm and starts the sync foreground service by explicit component`() {
    persistTickingState(context, isTicking = true, intervalMs = 60_000L)

    TickAlarmReceiver().onReceive(context, tickIntent())

    assertNotNull("the tick alarm must be re-armed", shadowOf(alarmManager).nextScheduledAlarm)

    val startedIntent = shadowOf(application).nextStartedService
    assertNotNull("the sync foreground service must be started", startedIntent)
    assertEquals(
      "the service must be started by its exact fully-qualified class name, not by import",
      SYNC_FOREGROUND_SERVICE_CLASS_NAME,
      startedIntent!!.component?.className,
    )
    assertEquals(
      "the start intent must carry the documented action",
      SYNC_FOREGROUND_SERVICE_ACTION,
      startedIntent.action,
    )
  }

  @Test
  fun `onReceive while not ticking starts nothing`() {
    persistTickingState(context, isTicking = false, intervalMs = 60_000L)

    TickAlarmReceiver().onReceive(context, tickIntent())

    assertNull("no alarm should be armed", shadowOf(alarmManager).nextScheduledAlarm)
    assertNull("no service should be started", shadowOf(application).nextStartedService)
  }

  @Test
  fun `onReceive leaves the alarm armed and does not throw when the service start throws`() {
    persistTickingState(context, isTicking = true, intervalMs = 60_000L)
    syncForegroundServiceStarter = { _ -> throw IllegalStateException("service start refused") }

    // Must not throw out of onReceive -- a crash here would take down whatever process this
    // receiver was woken into.
    TickAlarmReceiver().onReceive(context, tickIntent())

    assertNotNull(
      "the alarm must stay armed even when the service start throws",
      shadowOf(alarmManager).nextScheduledAlarm,
    )
  }

  @Test
  fun `onReceive ignores an intent with the wrong action`() {
    persistTickingState(context, isTicking = true, intervalMs = 60_000L)

    TickAlarmReceiver().onReceive(context, Intent("some.other.action"))

    assertNull("no alarm should be armed for an unrelated action", shadowOf(alarmManager).nextScheduledAlarm)
    assertNull("no service should be started for an unrelated action", shadowOf(application).nextStartedService)
  }
}
