package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * Behaviour of the native reader/writer of the JS-owned diagnostics outbox: oldest-first
 * candidates, the singleton not-before gate, confirmed removal, and the "a missing file or table
 * is a clean no-op that creates nothing" contract.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineDiagnosticsOutboxTest {

  @Test
  fun `reads the oldest candidates within the batch limit`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", "payload-1", 10L)
      fixture.seedTelemetryEntry("cycle-2", "payload-2", 20L)
      fixture.seedTelemetryEntry("cycle-3", "payload-3", 30L)
      fixture.seedTelemetryEntry("cycle-4", "payload-4", 40L)

      SyncEngineDiagnosticsOutbox(fixture.telemetryDatabaseFile).use { outbox ->
        assertEquals(
          listOf("cycle-1", "cycle-2", "cycle-3"),
          outbox.readCandidates(3, 0L).map { it.cycleId },
        )
        assertEquals(
          listOf("payload-1", "payload-2"),
          outbox.readCandidates(2, 0L).map { it.payload },
        )
        assertEquals(
          listOf(10L, 20L, 30L, 40L),
          outbox.readCandidates(10, 0L).map { it.createdAt },
        )
      }
    }
  }

  @Test
  fun `the not-before gate hides every candidate until it opens`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", "payload-1", 10L)
      fixture.seedTelemetryEntry("cycle-2", "payload-2", 20L)

      SyncEngineDiagnosticsOutbox(fixture.telemetryDatabaseFile).use { outbox ->
        assertEquals(null, fixture.telemetryNotBefore())

        outbox.deferUntil(500L)

        assertEquals(500L, fixture.telemetryNotBefore())
        assertEquals(emptyList<String>(), outbox.readCandidates(10, 499L).map { it.cycleId })
        assertEquals(listOf("cycle-1", "cycle-2"), outbox.readCandidates(10, 500L).map { it.cycleId })

        // Upsert, not insert: a second deferral must update the singleton row, not fail on it.
        outbox.deferUntil(600L)

        assertEquals(600L, fixture.telemetryNotBefore())
        assertEquals(emptyList<String>(), outbox.readCandidates(10, 599L).map { it.cycleId })
      }
    }
  }

  @Test
  fun `remove deletes exactly one cycle id and reports confirmation`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", "payload-1", 10L)
      fixture.seedTelemetryEntry("cycle-2", "payload-2", 20L)
      fixture.seedTelemetryEntry("cycle-3", "payload-3", 30L)

      SyncEngineDiagnosticsOutbox(fixture.telemetryDatabaseFile).use { outbox ->
        assertTrue(outbox.remove("cycle-2"))

        assertEquals(
          listOf("cycle-1" to "payload-1", "cycle-3" to "payload-3"),
          fixture.telemetryEntries(),
        )
        // JS parity: the store reports a confirmed removal whenever the DELETE did not throw, so a
        // cycle id that is already gone is confirmed too (nothing left to deliver for it).
        assertTrue(outbox.remove("cycle-2"))
      }
    }
  }

  @Test
  fun `a missing telemetry file is a clean no-op that creates nothing`() {
    SyncEngineTestDatabase().use { fixture ->
      assertFalse(fixture.telemetryDatabaseFile.exists())

      SyncEngineDiagnosticsOutbox(fixture.telemetryDatabaseFile).use { outbox ->
        assertEquals(emptyList<SyncDiagnosticsOutboxEntry>(), outbox.readCandidates(3, 0L))
        assertFalse(outbox.remove("cycle-1"))
        outbox.deferUntil(1_000L)
      }

      assertFalse("The store must never create the JS-owned database file", fixture.telemetryDatabaseFile.exists())
      assertEquals(emptyList<String>(), fixture.telemetryTables())
    }
  }

  @Test
  fun `a telemetry file without the outbox tables is a clean no-op that creates nothing`() {
    SyncEngineTestDatabase().use { fixture ->
      // A telemetry database provisioned by an older JS build: it exists, its outbox does not.
      SQLiteDatabase.openOrCreateDatabase(fixture.telemetryDatabaseFile, null).use { provisioned ->
        provisioned.execSQL("CREATE TABLE unrelated (id INTEGER)")
      }

      SyncEngineDiagnosticsOutbox(fixture.telemetryDatabaseFile).use { outbox ->
        assertEquals(emptyList<SyncDiagnosticsOutboxEntry>(), outbox.readCandidates(3, 0L))
        assertFalse(outbox.remove("cycle-1"))
        outbox.deferUntil(1_000L)
      }

      // The schema is JS-owned: a store that finds no table must not invent one.
      assertFalse(fixture.telemetryTables().contains("sync_diagnostics_outbox"))
      assertFalse(fixture.telemetryTables().contains("sync_diagnostics_outbox_state"))
      assertTrue(fixture.telemetryTables().contains("unrelated"))
    }
  }
}
