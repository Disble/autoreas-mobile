package expo.modules.syncengine

import java.net.SocketException
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * The diagnostics drain as the SYNC CYCLE runs it: the attempt drains the JS-owned outbox on the
 * way to its reconcile, the drained rows really leave the telemetry database, and -- whatever the
 * drain hits -- the attempt's own outcome, journal and lease are untouched.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineDiagnosticsCycleTest {

  @Test
  fun `cycle drains the stored diagnostics through the default courier and still closes`() {
    // The file-backed app database is what makes the default courier resolve its telemetry
    // sibling, i.e. this exercises the production wiring end to end.
    SyncEngineTestDatabase(appDatabaseIsFile = true).use { fixture ->
      SyncEngineTestHttpServer.scripted(
        listOf(
          SyncEngineTestHttpServer.Response(200, """{"status":"ok"}"""),
          SyncEngineTestHttpServer.Response(200, RECONCILE_RESPONSE),
        ),
      ).use { server ->
        val createdAt = insertCycleInput(fixture, server.port)
        val payload = """{"cycle_id":"cycle-diag-1"}"""
        fixture.seedTelemetryEntry("cycle-diag-1", payload, createdAt)
        val states = mutableListOf<String>()

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", "cycle-diag", states::add)

        assertEquals(CycleOutcome("closed", "closed", 1, 1, null), outcome)
        assertEquals(
          listOf("/api/sync/diagnostics", "/api/sync/reconcile"),
          server.requests.map { it.path },
        )
        assertEquals(payload, server.requests[0].body)
        assertEquals("Bearer token-1", server.requests[0].headers["authorization"])
        assertEquals(emptyList<Pair<String, String>>(), fixture.telemetryEntries())
        // The drain is not a journaled cycle step: the attempt's states are exactly what they were.
        assertEquals(listOf("checked", "claimed", "sent", "applied", "closed"), states)
      }
    }
  }

  @Test
  fun `pull only attempt drains the stored diagnostics too`() {
    SyncEngineTestDatabase(appDatabaseIsFile = true).use { fixture ->
      SyncEngineTestHttpServer.scripted(
        listOf(
          SyncEngineTestHttpServer.Response(200, """{"status":"ok"}"""),
          SyncEngineTestHttpServer.Response(200, RECONCILE_RESPONSE),
        ),
      ).use { server ->
        insertCycleInput(fixture, server.port, withPendingOperation = false)
        fixture.seedTelemetryEntry("cycle-diag-pull", """{"cycle_id":"cycle-diag-pull"}""", 10L)

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", "cycle-diag-pull-attempt", {})

        assertEquals(CycleOutcome("closed", "closed", 0, 0, null), outcome)
        assertEquals(
          listOf("/api/sync/diagnostics", "/api/sync/reconcile"),
          server.requests.map { it.path },
        )
        assertEquals(emptyList<Pair<String, String>>(), fixture.telemetryEntries())
      }
    }
  }

  @Test
  fun `a diagnostics transport failure keeps the row and does not change the cycle outcome`() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer(200, RECONCILE_RESPONSE).use { server ->
        insertCycleInput(fixture, server.port)
        fixture.seedTelemetryEntry("cycle-diag-1", "payload-1", 10L)
        val courier = SyncEngineDiagnosticsCourier(
          telemetryFile = fixture.telemetryDatabaseFile,
          transport = SyncDiagnosticsTransport { _, _, _, _ -> throw SocketException("bridge down") },
        )

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal, courier)
          .run("foreground", "cycle-diag-transport-failure", {})

        assertEquals(CycleOutcome("closed", "closed", 1, 1, null), outcome)
        assertEquals(listOf("/api/sync/reconcile"), server.requests.map { it.path })
        assertEquals(listOf("cycle-diag-1" to "payload-1"), fixture.telemetryEntries())
      }
    }
  }

  @Test
  fun `the disabled telemetry switch keeps the whole outbox untouched`() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer(200, RECONCILE_RESPONSE).use { server ->
        insertCycleInput(fixture, server.port, telemetrySwitch = "0")
        fixture.seedTelemetryEntry("cycle-diag-1", "payload-1", 10L)
        val transport = RecordingDiagnosticsTransport()
        val courier = SyncEngineDiagnosticsCourier(fixture.telemetryDatabaseFile, transport)

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal, courier)
          .run("foreground", "cycle-diag-switch-off", {})

        assertEquals(CycleOutcome("closed", "closed", 1, 1, null), outcome)
        assertEquals(listOf("/api/sync/reconcile"), server.requests.map { it.path })
        assertEquals(0, transport.posts.size)
        assertEquals(listOf("cycle-diag-1" to "payload-1"), fixture.telemetryEntries())
      }
    }
  }

  @Test
  fun `a missing bridge config never drains`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-diag-1", "payload-1", 10L)
      val transport = RecordingDiagnosticsTransport()
      val courier = SyncEngineDiagnosticsCourier(fixture.telemetryDatabaseFile, transport)

      val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal, courier)
        .run("foreground", "cycle-diag-no-config", {})

      assertEquals(CycleOutcome("not_applicable", "not_applicable", 0, 0, null), outcome)
      assertEquals(0, transport.posts.size)
      assertEquals(listOf("cycle-diag-1" to "payload-1"), fixture.telemetryEntries())
    }
  }

  /**
   * Seeds one bridge config (with the stored telemetry switch), the anime the reconcile request
   * names, and -- unless [withPendingOperation] is false -- one pending operation to claim.
   */
  private fun insertCycleInput(
    fixture: SyncEngineTestDatabase,
    port: Int,
    telemetrySwitch: String? = "1",
    withPendingOperation: Boolean = true,
  ): Long {
    fixture.appDatabase.execSQL(
      "INSERT INTO bridge_config " +
        "(id, device_id, ip, port, token, last_changelog_id, is_sync_telemetry_enabled) " +
        "VALUES (1, ?, ?, ?, ?, ?, ?)",
      arrayOf<Any?>("device-1", "127.0.0.1", port.toString(), "token-1", 20L, telemetrySwitch),
    )
    fixture.appDatabase.execSQL(
      "INSERT INTO animes (_id, bridge_modified_at) VALUES (?, ?)",
      arrayOf<Any>("anime-1", 7L),
    )
    val createdAt = System.currentTimeMillis()
    if (withPendingOperation) {
      fixture.appDatabase.execSQL(
        "INSERT INTO operation_log " +
          "(id, anime_id, operation, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        arrayOf<Any>(41L, "anime-1", "update", """{"status":2}""", "pending", createdAt),
      )
    }
    return createdAt
  }

  private companion object {
    const val RECONCILE_RESPONSE =
      """{"applied_operations":[{"anime_id":"anime-1","operation":"update","applied":true,"modified_at":14}],"last_changelog_id":25}"""
  }
}
