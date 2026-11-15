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
 * Robolectric tests for [SyncRestartReceiver]: a reboot or an app update kills the sync
 * foreground service and clears the tick alarm, and this receiver brings both back when the
 * persisted ticking state says background sync is on. Driven through a plain [Context], as
 * Android instantiates a manifest-declared receiver.
 */
@RunWith(RobolectricTestRunner::class)
class SyncRestartReceiverTest {

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

  private fun assertServiceStartedAndAlarmArmed() {
    assertNotNull("the tick alarm must be armed again", shadowOf(alarmManager).nextScheduledAlarm)
    val startedIntent = shadowOf(application).nextStartedService
    assertNotNull("the sync foreground service must be started", startedIntent)
    assertEquals(SYNC_FOREGROUND_SERVICE_CLASS_NAME, startedIntent!!.component?.className)
    assertEquals(SYNC_FOREGROUND_SERVICE_ACTION, startedIntent.action)
  }

  @Test
  fun `boot completed while ticking arms the alarm and starts the service`() {
    persistTickingState(context, isTicking = true, intervalMs = 60_000L)

    SyncRestartReceiver().onReceive(context, Intent(Intent.ACTION_BOOT_COMPLETED))

    assertServiceStartedAndAlarmArmed()
  }

  @Test
  fun `an app update while ticking arms the alarm and starts the service`() {
    persistTickingState(context, isTicking = true, intervalMs = 60_000L)

    SyncRestartReceiver().onReceive(context, Intent(Intent.ACTION_MY_PACKAGE_REPLACED))

    assertServiceStartedAndAlarmArmed()
  }

  @Test
  fun `boot completed while not ticking starts nothing`() {
    persistTickingState(context, isTicking = false, intervalMs = 60_000L)

    SyncRestartReceiver().onReceive(context, Intent(Intent.ACTION_BOOT_COMPLETED))

    assertNull(shadowOf(alarmManager).nextScheduledAlarm)
    assertNull(shadowOf(application).nextStartedService)
  }

  @Test
  fun `a refused service start leaves the alarm armed and does not throw`() {
    persistTickingState(context, isTicking = true, intervalMs = 60_000L)
    syncForegroundServiceStarter = { _ -> throw IllegalStateException("refused") }

    SyncRestartReceiver().onReceive(context, Intent(Intent.ACTION_BOOT_COMPLETED))

    assertNotNull("the tick alarm must be armed again", shadowOf(alarmManager).nextScheduledAlarm)
  }

  @Test
  fun `any other action starts nothing`() {
    persistTickingState(context, isTicking = true, intervalMs = 60_000L)

    SyncRestartReceiver().onReceive(context, Intent(Intent.ACTION_TIME_CHANGED))

    assertNull(shadowOf(alarmManager).nextScheduledAlarm)
    assertNull(shadowOf(application).nextStartedService)
  }
}
