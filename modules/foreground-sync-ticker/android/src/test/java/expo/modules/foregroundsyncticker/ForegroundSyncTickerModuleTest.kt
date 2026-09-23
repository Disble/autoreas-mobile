package expo.modules.foregroundsyncticker

import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Plain-JUnit test (no Robolectric, no `AppContext`) proving the `onTick` dispatch mechanism this
 * class used to expose is retired (ODD native-foreground-sync-service T4). This is the one
 * assertion of the T4 test plan that cannot be exercised through [expo.modules.kotlin.modules.Module]
 * itself: `sendEvent` requires a registered `AppContext`
 * (`expo.modules.kotlin.modules.Module.appContext` throws "The module wasn't created!" without
 * one), and this repo's Robolectric harness does not stand up the Expo module registry needed to
 * provide one -- the same limitation the feature document records for `SyncEngineModule.kt`
 * ("nothing in Kotlin: a thin adapter, its JS contract is covered by Jest"). Reflection over the
 * class's own declared members is therefore the meaningful, testable proxy: before T4 this class
 * declared `onAlarmReceived()` (the sole caller of `sendEvent("onTick", ...)`) and an
 * `activeInstance` companion property [TickAlarmReceiver] dispatched through; after T4 neither
 * exists, so there is no code path left, anywhere in this class, capable of emitting `onTick`.
 *
 * The `onAlarmReceived` check matches by PREFIX, not exact equality: Kotlin mangles the JVM name
 * of an `internal` member (e.g. `onAlarmReceived$foreground_sync_ticker_debug`) to avoid clashing
 * with a same-named internal member in a different module, since JVM has no `internal` visibility
 * of its own. An exact `"onAlarmReceived"` match would silently never match the real, mangled
 * method name and this test would pass even with the method still present -- confirmed by
 * mutation: re-adding `internal fun onAlarmReceived()` to the class did NOT fail this test until
 * the match was changed from exact equality to `startsWith`.
 */
class ForegroundSyncTickerModuleTest {

  @Test
  fun `no onAlarmReceived dispatch entry point remains on the module`() {
    val methodNames = ForegroundSyncTickerModule::class.java.declaredMethods.map { it.name }

    assertFalse(
      "onAlarmReceived (the former onTick dispatch entry point, called by TickAlarmReceiver's " +
        "old activeInstance-based dispatch) must not exist: T4 retired native onTick dispatch " +
        "entirely, and T5 dropped the now-inert Events(\"onTick\") declaration itself",
      methodNames.any { it.startsWith("onAlarmReceived") },
    )
  }

  @Test
  fun `no activeInstance dispatch target remains on the module`() {
    // Checked without a compile-time reference to a `Companion` nested class -- T4 removes the
    // companion object entirely, and this assertion must keep compiling either way, so it walks
    // whatever nested classes (if any) the outer class still declares.
    val outerClass = ForegroundSyncTickerModule::class.java
    val declaredMemberNames = outerClass.declaredFields.map { it.name } +
      outerClass.declaredClasses.flatMap { nested -> nested.declaredFields.map { it.name } }

    assertFalse(
      "activeInstance (the live-instance registry TickAlarmReceiver used to dispatch onTick " +
        "through) must not exist: the receiver no longer references any module instance at all",
      declaredMemberNames.any { it.contains("activeInstance", ignoreCase = true) },
    )
  }
}
