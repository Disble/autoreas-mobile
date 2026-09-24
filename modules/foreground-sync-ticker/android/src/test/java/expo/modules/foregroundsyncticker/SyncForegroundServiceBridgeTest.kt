package expo.modules.foregroundsyncticker

import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Robolectric tests for [startSyncForegroundServiceSafely] itself (ODD native-foreground-sync-
 * service T4), called directly rather than through [TickAlarmReceiver]. [TickAlarmReceiver]'s own
 * `onReceive` has its own outer `catch (error: Exception)`, which would swallow a thrown starter
 * on its own -- so a mutation that deletes THIS function's own try/catch would pass unnoticed if
 * only ever exercised through the receiver. Calling it directly closes that gap, and also proves
 * the swallow-and-log behaviour for [TickAlarmScheduler.kt]'s `startSyncTicking` (the module's
 * `start()` path), which has no outer catch of its own to fall back on.
 */
@RunWith(RobolectricTestRunner::class)
class SyncForegroundServiceBridgeTest {

  private val application: Application = ApplicationProvider.getApplicationContext()

  @Before
  fun setUp() {
    syncForegroundServiceStarter = ::defaultSyncForegroundServiceStarter
  }

  @After
  fun tearDown() {
    syncForegroundServiceStarter = ::defaultSyncForegroundServiceStarter
  }

  @Test
  fun `startSyncForegroundServiceSafely does not throw when the injected starter throws`() {
    syncForegroundServiceStarter = { _ -> throw IllegalStateException("service start refused") }

    // Must not throw: this is the one guarantee that keeps a platform refusal from crashing
    // either of this function's callers.
    startSyncForegroundServiceSafely(application)
  }

  @Test
  fun `startSyncForegroundServiceSafely delegates to the injected starter with the given context`() {
    var receivedContext: Context? = null
    syncForegroundServiceStarter = { context -> receivedContext = context }

    startSyncForegroundServiceSafely(application)

    assertEquals(application, receivedContext)
  }
}
