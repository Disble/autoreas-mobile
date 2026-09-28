package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Plain-JUnit tests for [SyncEngineProcess] (ODD mobile-database-recovery T3 slice B2a): the pure,
 * side-effect-free decision that keeps a second Android process from opening `autoreas.db` through
 * the framework SQLite core. No `@RunWith(Robolectric)` is needed -- the unit under test is the
 * predicate and the refusal shape, both pure; the thin process-name reader is Android's, and it is
 * exercised through [SyncEngineProcess.isMainProcess]'s conservative answer instead.
 */
class SyncEngineProcessTest {

  private val packageName = "com.example.autoreas"

  @Test
  fun `the app main process is the only allowed process`() {
    assertTrue(
      "the bare package name is the app's main process",
      SyncEngineProcess.isMainProcess(packageName, packageName),
    )
  }

  @Test
  fun `a private app process is not the main process`() {
    assertFalse(
      "Android names a private process '<package>:<suffix>'; ':sync' must not match the bare package",
      SyncEngineProcess.isMainProcess("$packageName:sync", packageName),
    )
  }

  @Test
  fun `a different package is not the main process`() {
    assertFalse(
      SyncEngineProcess.isMainProcess("com.other.app", packageName),
    )
  }

  @Test
  fun `a null process name is refused conservatively`() {
    assertFalse(
      "an unreadable process name must not be trusted as the main process",
      SyncEngineProcess.isMainProcess(null, packageName),
    )
  }

  @Test
  fun `a blank process name is refused conservatively`() {
    assertFalse(
      "an empty process name must not be trusted as the main process",
      SyncEngineProcess.isMainProcess("", packageName),
    )
    assertFalse(
      "a whitespace-only process name must not be trusted as the main process",
      SyncEngineProcess.isMainProcess("   ", packageName),
    )
  }

  @Test
  fun `surrounding whitespace is normalized before the comparison`() {
    assertTrue(
      "a padded process name must normalize to the main process",
      SyncEngineProcess.isMainProcess("  $packageName  ", packageName),
    )
  }

  @Test
  fun `the refusal code is null only for the main process`() {
    assertNull(
      "the main process must not produce a refusal code",
      SyncEngineProcess.refusalCodeFor(packageName, packageName),
    )
    assertEquals(
      "a non-main process must produce the stable refusal code",
      SYNC_ENGINE_WRONG_PROCESS_ERROR_CODE,
      SyncEngineProcess.refusalCodeFor("$packageName:sync", packageName),
    )
    assertEquals(
      "an unknown process name must produce the stable refusal code",
      SYNC_ENGINE_WRONG_PROCESS_ERROR_CODE,
      SyncEngineProcess.refusalCodeFor(null, packageName),
    )
  }

  @Test
  fun `the refusal shape is stable and non-sensitive`() {
    assertEquals("ERR_SYNC_ENGINE_WRONG_PROCESS", SYNC_ENGINE_WRONG_PROCESS_ERROR_CODE)
    assertEquals(
      "Native sync runOnce is refused: it may only run in the app's main process.",
      SYNC_ENGINE_WRONG_PROCESS_MESSAGE,
    )
  }
}
