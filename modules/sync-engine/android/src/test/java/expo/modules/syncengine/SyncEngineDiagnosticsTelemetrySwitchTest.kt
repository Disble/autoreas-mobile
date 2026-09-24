package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * Maps `bridge_config.is_sync_telemetry_enabled` onto the user's diagnostics switch, the one
 * place the native side resolves it. The stated mapping (mirroring `isSyncTelemetryEnabled` plus
 * drizzle's `Number(value) === 1` boolean reader):
 *
 * - stored `NULL` -> ENABLED: absence is not a choice, so a row that predates the column must not
 *   be silenced;
 * - stored `1` -> ENABLED (the only value the JS predicate's `value === true` accepts);
 * - stored `0`, `2`, any other number, and any text that is not a number -> DISABLED: a value the
 *   user never chose must never start a transmission;
 * - an UNREADABLE column (a store that has not run the migration yet) -> ENABLED, and the config
 *   itself still reads, because the column's absence is not the user turning anything off.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineDiagnosticsTelemetrySwitchTest {

  @Test
  fun `maps every stored switch shape onto the documented position`() {
    assertEquals(true, isSyncTelemetryEnabled(null))
    assertEquals(true, isSyncTelemetryEnabled("1"))
    assertEquals(true, isSyncTelemetryEnabled(" 1 "))
    assertEquals(true, isSyncTelemetryEnabled("1.0"))

    assertEquals(false, isSyncTelemetryEnabled(""))
    assertEquals(false, isSyncTelemetryEnabled("0"))
    assertEquals(false, isSyncTelemetryEnabled("2"))
    assertEquals(false, isSyncTelemetryEnabled("-1"))
    assertEquals(false, isSyncTelemetryEnabled("abc"))
    assertEquals(false, isSyncTelemetryEnabled("1abc"))
    assertEquals(false, isSyncTelemetryEnabled("true"))
  }

  @Test
  fun `reads the switch back from a migrated bridge config row`() {
    SyncEngineTestDatabase().use { fixture ->
      assertEquals(true, switchFrom(fixture, "1"))
      assertEquals(false, switchFrom(fixture, "0"))
      assertEquals(false, switchFrom(fixture, "2"))
      assertEquals(false, switchFrom(fixture, "abc"))
      assertEquals(true, switchFrom(fixture, null))
    }
  }

  @Test
  fun `an unreadable switch column reads as enabled and still yields the config`() {
    // A store that has not run the telemetry-switch migration: the column does not exist yet.
    legacyStore().use { legacy ->
      val config = readBridgeConfig(legacy)

      assertEquals(1L, config?.id)
      assertEquals("device-legacy", config?.deviceId)
      assertEquals(7L, config?.lastChangelogId)
      assertEquals(true, config?.isSyncTelemetryEnabled)
    }
  }

  @Test
  fun `a store without bridge config still reads as no config`() {
    SQLiteDatabase.create(null).use { empty ->
      assertNull(readBridgeConfig(empty))
    }
  }

  /** Writes [storedValue] into the fixture's single config row and reads the switch back. */
  private fun switchFrom(fixture: SyncEngineTestDatabase, storedValue: String?): Boolean? {
    fixture.appDatabase.execSQL("DELETE FROM bridge_config")
    fixture.appDatabase.execSQL(
      "INSERT INTO bridge_config (id, is_sync_telemetry_enabled) VALUES (1, ?)",
      arrayOf(storedValue),
    )
    return readBridgeConfig(fixture.appDatabase)?.isSyncTelemetryEnabled
  }

  private fun legacyStore(): SQLiteDatabase = SQLiteDatabase.create(null).apply {
    execSQL(
      "CREATE TABLE bridge_config (id INTEGER PRIMARY KEY, device_id TEXT, ip TEXT, port TEXT, " +
        "token TEXT, last_changelog_id INTEGER)",
    )
    execSQL(
      "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) " +
        "VALUES (1, 'device-legacy', '127.0.0.1', '8080', 'token-legacy', 7)",
    )
  }
}
