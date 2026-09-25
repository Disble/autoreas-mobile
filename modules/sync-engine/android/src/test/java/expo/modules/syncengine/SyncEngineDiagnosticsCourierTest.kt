package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * Records every diagnostics POST it receives and answers from [respond], which is handed the
 * zero-based post index so a test can script a per-envelope sequence.
 */
internal class RecordingDiagnosticsTransport(
  private val respond: (Int) -> SyncDiagnosticsPostResult = { SyncDiagnosticsPostResult(200) },
) : SyncDiagnosticsTransport {
  data class Post(val url: String, val token: String, val body: String, val timeoutMs: Int)

  val posts = mutableListOf<Post>()

  override fun post(url: String, token: String, body: String, timeoutMs: Int): SyncDiagnosticsPostResult {
    posts.add(Post(url, token, body, timeoutMs))
    return respond(posts.size - 1)
  }
}

/**
 * One stored legacy cycle envelope: the kindless body the bridge's frozen rule still accepts, and
 * therefore the only shape that is ROUTABLE without a declared kind. The verdict-ladder tests seed
 * this rather than an arbitrary string, because arbitrary bytes are now PARKED -- see
 * `classifyDiagnosticsPayload`.
 */
private fun legacyEnvelope(cycleId: String): String = """{"cycle_id":"$cycleId"}"""

/**
 * The diagnostics drain's disposition ladder: which status codes delete a stored envelope, which
 * one defers and stops, which ones only stop, and the guarantees that surround them -- the user's
 * switch is consulted first, the stored payload is never re-serialized, and no failure ever
 * escapes as an exception.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineDiagnosticsCourierTest {

  @Test
  fun `two hundred deletes the row and reports it delivered`() {
    SyncEngineTestDatabase().use { fixture ->
      val payload = legacyEnvelope("cycle-1")
      fixture.seedTelemetryEntry("cycle-1", payload, 10L)
      val transport = RecordingDiagnosticsTransport()

      val result = drain(fixture, transport)

      assertEquals(SyncDiagnosticsFlushResult(attempted = 1, delivered = 1), result)
      assertEquals(emptyList<Pair<String, String>>(), fixture.telemetryEntries())
      assertEquals(
        listOf(RecordingDiagnosticsTransport.Post(CONNECTION_URL, "token-1", payload, SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS)),
        transport.posts,
      )
    }
  }

  @Test
  fun `every two hundred status deletes the row`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", legacyEnvelope("cycle-1"), 10L)
      fixture.seedTelemetryEntry("cycle-2", legacyEnvelope("cycle-2"), 20L)
      val transport = RecordingDiagnosticsTransport { index ->
        if (index == 0) SyncDiagnosticsPostResult(204) else SyncDiagnosticsPostResult(201)
      }

      val result = drain(fixture, transport)

      assertEquals(SyncDiagnosticsFlushResult(attempted = 2, delivered = 2), result)
      assertEquals(emptyList<Pair<String, String>>(), fixture.telemetryEntries())
    }
  }

  @Test
  fun `a declared refusal code decides before the permanence set`() {
    // The codes are asserted as LITERAL strings, never read through the constant the drainer
    // branches on: a test using the same constant as the code asserts only that the constant equals
    // itself, and would keep passing while a mutated constant destroyed a recoverable backlog.
    // `kind_not_served` is the vocabulary's ONE recoverable member -- its bytes are not wrong, that
    // build simply does not serve the kind -- so the row is KEPT and the batch STOPS. Every other
    // DECLARED member keeps the status verdict, and a refusal declaring NO code -- `401` is written
    // by shared authentication -- is answered by its status alone (see the codeless `400` row).
    val rows = listOf("cycle-1" to legacyEnvelope("cycle-1"), "cycle-2" to legacyEnvelope("cycle-2"))
    val stopped = SyncDiagnosticsFlushResult(attempted = 1) to rows
    val destroyed = SyncDiagnosticsFlushResult(attempted = 2, delivered = 1, discarded = 1) to
      emptyList<Pair<String, String>>()
    val refusals = listOf(
      SyncDiagnosticsPostResult(400, refusalCode = "kind_not_served") to stopped,
      SyncDiagnosticsPostResult(400, refusalCode = "kind_malformed") to destroyed,
      SyncDiagnosticsPostResult(400, refusalCode = "body_unreadable") to destroyed,
      SyncDiagnosticsPostResult(400, refusalCode = "field_rejected") to destroyed,
      SyncDiagnosticsPostResult(413, refusalCode = "body_too_large") to destroyed,
      SyncDiagnosticsPostResult(400) to stopped, // CONTRACT CORRECTION: codeless 400 = bridge VERSION state -> PARKS
      SyncDiagnosticsPostResult(401) to stopped,
    )
    for ((refusal, expected) in refusals) {
      SyncEngineTestDatabase().use { fixture ->
        fixture.seedTelemetryEntry("cycle-1", legacyEnvelope("cycle-1"), 10L)
        fixture.seedTelemetryEntry("cycle-2", legacyEnvelope("cycle-2"), 20L)
        val transport = RecordingDiagnosticsTransport { index ->
          if (index == 0) refusal else SyncDiagnosticsPostResult(200)
        }

        val result = drain(fixture, transport)
        // Kept: still stored, one request spent. Destroyed: gone, batch went on to cycle-2.
        assertEquals("$refusal", expected.first, result)
        assertEquals("$refusal", expected.second, fixture.telemetryEntries())
        assertEquals("$refusal", result.attempted, transport.posts.size)
      }
    }
  }

  @Test
  fun `payload too large discards the row while unprocessable entity keeps it`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", legacyEnvelope("cycle-1"), 10L)
      fixture.seedTelemetryEntry("cycle-2", legacyEnvelope("cycle-2"), 20L)
      val transport = RecordingDiagnosticsTransport { index ->
        if (index == 0) SyncDiagnosticsPostResult(413) else SyncDiagnosticsPostResult(422)
      }

      val result = drain(fixture, transport)

      // 413 is part of the bridge's permanence declaration for THIS body, so the row goes;
      // 422 is a different endpoint's rule the bridge never declared here, and anything the
      // contract does not declare is retryable -- so cycle-2 stays queued and the batch stops.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 2, discarded = 1), result)
      assertEquals(listOf("cycle-2" to legacyEnvelope("cycle-2")), fixture.telemetryEntries())
      assertEquals(2, transport.posts.size)
      assertNull(fixture.telemetryNotBefore())
    }
  }

  @Test
  fun `too many requests persists the not-before gate and stops the batch`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", legacyEnvelope("cycle-1"), 10L)
      fixture.seedTelemetryEntry("cycle-2", legacyEnvelope("cycle-2"), 20L)
      val transport = RecordingDiagnosticsTransport {
        SyncDiagnosticsPostResult(429, retryAfterMillis = 120_000L)
      }

      val result = drain(fixture, transport)

      assertEquals(SyncDiagnosticsFlushResult(attempted = 1), result)
      assertEquals(1, transport.posts.size)
      assertEquals(
        listOf("cycle-1" to legacyEnvelope("cycle-1"), "cycle-2" to legacyEnvelope("cycle-2")),
        fixture.telemetryEntries(),
      )
      assertEquals(NOW_MS + 120_000L, fixture.telemetryNotBefore())
    }
  }

  @Test
  fun `service unavailable without a retry after still defers to the bridge's declared wait`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", legacyEnvelope("cycle-1"), 10L)
      fixture.seedTelemetryEntry("cycle-2", legacyEnvelope("cycle-2"), 20L)
      val transport = RecordingDiagnosticsTransport { SyncDiagnosticsPostResult(503) }

      val result = drain(fixture, transport)

      // The bridge declares 503 as its OWN backpressure status ("503 with Retry-After: 5"), so a
      // 503 without the header is that same declaration with the header lost in transit, and the
      // declared wait is what keeps this pass from hot-looping against a bridge asking for room.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 1), result)
      assertEquals(1, transport.posts.size)
      assertEquals(
        listOf("cycle-1" to legacyEnvelope("cycle-1"), "cycle-2" to legacyEnvelope("cycle-2")),
        fixture.telemetryEntries(),
      )
      assertEquals(NOW_MS + SYNC_DIAGNOSTICS_UNAVAILABLE_RETRY_AFTER_MS, fixture.telemetryNotBefore())
    }
  }

  @Test
  fun `not found keeps the row, stops, and defers nothing`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", legacyEnvelope("cycle-1"), 10L)
      fixture.seedTelemetryEntry("cycle-2", legacyEnvelope("cycle-2"), 20L)
      val transport = RecordingDiagnosticsTransport { SyncDiagnosticsPostResult(404) }

      val result = drain(fixture, transport)

      assertEquals(SyncDiagnosticsFlushResult(attempted = 1), result)
      assertEquals(1, transport.posts.size)
      assertEquals(
        listOf("cycle-1" to legacyEnvelope("cycle-1"), "cycle-2" to legacyEnvelope("cycle-2")),
        fixture.telemetryEntries(),
      )
      assertNull(fixture.telemetryNotBefore())
    }
  }

  @Test
  fun `a transport failure keeps the row, stops, and never throws`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", legacyEnvelope("cycle-1"), 10L)
      val transport = RecordingDiagnosticsTransport { throw java.net.SocketException("bridge down") }

      val result = drain(fixture, transport)

      assertEquals(SyncDiagnosticsFlushResult(attempted = 1), result)
      assertEquals(listOf("cycle-1" to legacyEnvelope("cycle-1")), fixture.telemetryEntries())
      assertNull(fixture.telemetryNotBefore())
    }
  }

  @Test
  fun `stops after one batch and leaves the newer rows behind`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", legacyEnvelope("cycle-1"), 10L)
      fixture.seedTelemetryEntry("cycle-2", legacyEnvelope("cycle-2"), 20L)
      fixture.seedTelemetryEntry("cycle-3", legacyEnvelope("cycle-3"), 30L)
      fixture.seedTelemetryEntry("cycle-4", legacyEnvelope("cycle-4"), 40L)
      val transport = RecordingDiagnosticsTransport()

      val result = drain(fixture, transport)

      assertEquals(SyncDiagnosticsFlushResult(attempted = 3, delivered = 3), result)
      assertEquals(
        listOf(legacyEnvelope("cycle-1"), legacyEnvelope("cycle-2"), legacyEnvelope("cycle-3")),
        transport.posts.map { it.body },
      )
      assertEquals(listOf("cycle-4" to legacyEnvelope("cycle-4")), fixture.telemetryEntries())
    }
  }

  @Test
  fun `a kindless body routes while an undeclared kind parks unposted and undeleted`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", """{"cycle_id":"cycle-1"}""", 10L)
      fixture.seedTelemetryEntry(
        "cycle-2",
        """{"cycle_id":"cycle-2","kind":"episode_action"}""",
        20L,
      )
      fixture.seedTelemetryEntry("cycle-3", """{"cycle_id":"cycle-3"}""", 30L)
      val transport = RecordingDiagnosticsTransport()

      val result = drain(fixture, transport)

      // The parked row is neither posted nor deleted, and -- the whole point of parking rather
      // than stopping -- the batch CONTINUES past it, so the deliverable rows behind it still go
      // out. An undeclared kind is invisible in `discarded` on purpose: nothing was destroyed.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 2, delivered = 2, unclassified = 1), result)
      assertEquals(
        listOf("""{"cycle_id":"cycle-1"}""", """{"cycle_id":"cycle-3"}"""),
        transport.posts.map { it.body },
      )
      assertEquals(
        listOf("cycle-2" to """{"cycle_id":"cycle-2","kind":"episode_action"}"""),
        fixture.telemetryEntries(),
      )
    }
  }

  @Test
  fun `a kind the registry accepts is routed verbatim`() {
    SyncEngineTestDatabase().use { fixture ->
      val payload = """{"cycle_id":"cycle-flip","kind":"episode_action"}"""
      fixture.seedTelemetryEntry("cycle-flip", payload, 10L)
      val transport = RecordingDiagnosticsTransport()

      val courier = SyncEngineDiagnosticsCourier(
        telemetryFile = fixture.telemetryDatabaseFile,
        transport = transport,
        now = { NOW_MS },
        acceptedKinds = setOf("episode_action"),
      )
      val result = courier.drain(isSyncTelemetryEnabled = true, connection = CONNECTION)

      // The flip that ships the first accepted kind is this one set, and nothing else changes:
      // the same body that parked above is delivered, byte for byte.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 1, delivered = 1), result)
      assertEquals(listOf(payload), transport.posts.map { it.body })
      assertEquals(emptyList<Pair<String, String>>(), fixture.telemetryEntries())
    }
  }

  @Test
  fun `a kind this build declares undeliverable is deleted on sight without a request`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry(
        "cycle-retired",
        """{"cycle_id":"cycle-retired","kind":"retired_kind"}""",
        10L,
      )
      fixture.seedTelemetryEntry("cycle-legacy", legacyEnvelope("cycle-legacy"), 20L)
      val transport = RecordingDiagnosticsTransport()

      val courier = SyncEngineDiagnosticsCourier(
        telemetryFile = fixture.telemetryDatabaseFile,
        transport = transport,
        now = { NOW_MS },
        undeliverableKinds = setOf("retired_kind"),
      )
      val result = courier.drain(isSyncTelemetryEnabled = true, connection = CONNECTION)

      // Destruction by DECLARATION: the row never reaches the wire, and `discarded` stays reserved
      // for the bridge's own verdicts so the two kinds of loss are never conflated. The batch
      // continues, so the deliverable row behind the destroyed one is still delivered.
      assertEquals(
        SyncDiagnosticsFlushResult(attempted = 1, delivered = 1, undeliverable = 1),
        result,
      )
      assertEquals(listOf(legacyEnvelope("cycle-legacy")), transport.posts.map { it.body })
      assertEquals(emptyList<Pair<String, String>>(), fixture.telemetryEntries())
    }
  }

  @Test
  fun `a present null kind parks unposted and undeleted while the batch delivers the row behind it`() {
    SyncEngineTestDatabase().use { fixture ->
      val stored = """{"cycle_id":"cycle-null","kind":null}"""
      fixture.seedTelemetryEntry("cycle-null", stored, 10L)
      fixture.seedTelemetryEntry("cycle-legacy", legacyEnvelope("cycle-legacy"), 20L)
      val transport = RecordingDiagnosticsTransport()

      val result = drain(fixture, transport)

      // `null` is a DECLARATION, not the frozen rule: the bridge's compatibility case is the
      // ABSENCE of the `kind` KEY, and a value this build cannot name is not an absence. Routing it
      // would spend a POST the bridge answers with 400, and 400 is definitive -- so routing here
      // DESTROYS the row instead of parking it.
      assertEquals(
        SyncDiagnosticsFlushResult(attempted = 1, delivered = 1, unclassified = 1),
        result,
      )
      assertEquals(listOf(legacyEnvelope("cycle-legacy")), transport.posts.map { it.body })
      assertEquals(listOf("cycle-null" to stored), fixture.telemetryEntries())
    }
  }

  @Test
  fun `a body that is not a JSON object parks unposted and undeleted while the batch continues`() {
    // Invalid JSON, and valid JSON that is not an object: no `kind` can be read from either, and
    // this build cannot read a POSITIVE declaration out of bytes that are not an object.
    val bodies = listOf(
      "payload-unreadable", // not JSON at all
      "[1,2,3]", // a JSON array
      "\"chapter_action\"", // a bare JSON string
      "null", // the JSON null literal
      "42", // a bare JSON number
    )

    for (body in bodies) {
      SyncEngineTestDatabase().use { fixture ->
        fixture.seedTelemetryEntry("poison-1", body, 10L)
        fixture.seedTelemetryEntry("cycle-legacy", legacyEnvelope("cycle-legacy"), 20L)
        val transport = RecordingDiagnosticsTransport()

        val result = drain(fixture, transport)

        // Parking, never stopping: stopping would strand every deliverable row behind one poison
        // row on every future pass -- the starvation class this work already had to fix twice.
        assertEquals(
          body,
          SyncDiagnosticsFlushResult(attempted = 1, delivered = 1, unclassified = 1),
          result,
        )
        assertEquals(body, listOf(legacyEnvelope("cycle-legacy")), transport.posts.map { it.body })
        assertEquals(body, listOf("poison-1" to body), fixture.telemetryEntries())
      }
    }
  }

  @Test
  fun `a closed not-before gate skips the whole batch`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", "payload-1", 10L)
      fixture.openTelemetryOutbox().execSQL(
        "INSERT INTO sync_diagnostics_outbox_state (id, not_before) VALUES (1, ?)",
        arrayOf<Any>(NOW_MS + 60_000L),
      )
      val transport = RecordingDiagnosticsTransport()

      val result = drain(fixture, transport)

      assertEquals(SyncDiagnosticsFlushResult(), result)
      assertEquals(0, transport.posts.size)
      assertEquals(listOf("cycle-1" to "payload-1"), fixture.telemetryEntries())
    }
  }

  @Test
  fun `the disabled switch returns the zeroed tally without reading or posting anything`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", "payload-1", 10L)
      fixture.seedTelemetryEntry("cycle-2", "payload-2", 20L)
      val transport = RecordingDiagnosticsTransport()

      val result = drain(fixture, transport, enabled = false)

      assertEquals(SyncDiagnosticsFlushResult(), result)
      assertEquals(0, transport.posts.size)
      assertEquals(listOf("cycle-1" to "payload-1", "cycle-2" to "payload-2"), fixture.telemetryEntries())
      assertNull(fixture.telemetryNotBefore())
    }
  }

  @Test
  fun `an incomplete connection and a missing telemetry file are clean no-ops`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", "payload-1", 10L)
      val transport = RecordingDiagnosticsTransport()

      val blank = drain(fixture, transport, connection = SyncDiagnosticsConnection("", "8080", "t"))
      val missingFile = SyncEngineDiagnosticsCourier(null, transport, { NOW_MS }).drain(
        isSyncTelemetryEnabled = true,
        connection = CONNECTION,
      )

      assertEquals(SyncDiagnosticsFlushResult(), blank)
      assertEquals(SyncDiagnosticsFlushResult(), missingFile)
      assertEquals(0, transport.posts.size)
      assertEquals(listOf("cycle-1" to "payload-1"), fixture.telemetryEntries())
    }
  }

  @Test
  fun `the drain budget bounds how many requests one pass can start`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", legacyEnvelope("cycle-1"), 10L)
      fixture.seedTelemetryEntry("cycle-2", legacyEnvelope("cycle-2"), 20L)
      fixture.seedTelemetryEntry("cycle-3", legacyEnvelope("cycle-3"), 30L)
      var clock = NOW_MS
      // Each response costs 4.5 s of the 6 s native bound: the second request must be shortened
      // to what is left, and the third must never start.
      val transport = RecordingDiagnosticsTransport {
        clock += 4_500L
        SyncDiagnosticsPostResult(200)
      }

      val result = SyncEngineDiagnosticsCourier(fixture.telemetryDatabaseFile, transport, { clock }).drain(
        isSyncTelemetryEnabled = true,
        connection = CONNECTION,
      )

      assertEquals(SyncDiagnosticsFlushResult(attempted = 2, delivered = 2), result)
      assertEquals(listOf(3_000, 1_500), transport.posts.map { it.timeoutMs })
      assertEquals(listOf("cycle-3" to legacyEnvelope("cycle-3")), fixture.telemetryEntries())
    }
  }

  @Test
  fun `for an app database without a file the courier has nothing to drain`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", "payload-1", 10L)
      val transport = RecordingDiagnosticsTransport()

      // The in-memory app database has no path, so no telemetry sibling can be derived from it.
      val courier = SyncEngineDiagnosticsCourier.forAppDatabase(fixture.appDatabase, transport)
      val result = courier.drain(isSyncTelemetryEnabled = true, connection = CONNECTION)

      assertEquals(SyncDiagnosticsFlushResult(), result)
      assertEquals(0, transport.posts.size)
      assertEquals(listOf("cycle-1" to "payload-1"), fixture.telemetryEntries())
    }
  }

  @Test
  fun `for a file backed app database the courier resolves the telemetry sibling`() {
    SyncEngineTestDatabase(appDatabaseIsFile = true).use { fixture ->
      fixture.seedTelemetryEntry("cycle-1", legacyEnvelope("cycle-1"), 10L)
      val transport = RecordingDiagnosticsTransport()

      val courier = SyncEngineDiagnosticsCourier.forAppDatabase(fixture.appDatabase, transport)
      val result = courier.drain(isSyncTelemetryEnabled = true, connection = CONNECTION)

      assertEquals(SyncDiagnosticsFlushResult(attempted = 1, delivered = 1), result)
      assertEquals(listOf(legacyEnvelope("cycle-1")), transport.posts.map { it.body })
      assertEquals(emptyList<Pair<String, String>>(), fixture.telemetryEntries())
    }
  }

  private fun drain(
    fixture: SyncEngineTestDatabase,
    transport: SyncDiagnosticsTransport,
    enabled: Boolean = true,
    connection: SyncDiagnosticsConnection = CONNECTION,
  ): SyncDiagnosticsFlushResult = SyncEngineDiagnosticsCourier(
    fixture.telemetryDatabaseFile,
    transport,
    { NOW_MS },
  ).drain(isSyncTelemetryEnabled = enabled, connection = connection)

  private companion object {
    const val NOW_MS = 1_000L
    const val CONNECTION_URL = "http://127.0.0.1:8080/api/sync/diagnostics"
    val CONNECTION = SyncDiagnosticsConnection("127.0.0.1", "8080", "token-1")
  }
}
