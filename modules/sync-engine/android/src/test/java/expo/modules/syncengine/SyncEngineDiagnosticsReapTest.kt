package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/** One stored legacy cycle envelope: the kindless body the bridge's frozen rule still accepts. */
private fun storedLegacyEnvelope(cycleId: String): String = """{"cycle_id":"$cycleId"}"""

/**
 * The three disposition rules this round brings the native courier into agreement with the JS
 * drainer on: what a refusal may destroy, what counts as a DECLARED refusal code, and the age bound
 * that retires a PARKED row without ever touching a pending one.
 *
 * These live apart from `SyncEngineDiagnosticsCourierTest` because that file is at the repository's
 * 500-line ceiling, and because the rules themselves live apart from the loop that applies them
 * (`SyncEngineDiagnosticsReap.kt`, mirroring the JS side's `sync-diagnostics-disposition.helpers.ts`
 * against its own executor).
 *
 * Every status, refusal code and AGE here is a LITERAL, computed from no production constant: a test
 * comparing a value against the same constant the code reads asserts only that the constant equals
 * itself, and stays green while the drain destroys a backlog it meant to keep.
 *
 * Two clocks appear deliberately, and neither is shared. This file owns [NOW_MS], a realistic
 * instant, so its ages are ordinary positive epoch millis; the capped courier suite keeps its own
 * `NOW_MS = 1_000L` untouched, because raising THAT one would move its parked rows past the bound.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineDiagnosticsReapTest {

  @Test
  fun `a codeless 400 keeps the row and stops the batch`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedRow("cycle-1", storedLegacyEnvelope("cycle-1"), FRESH_AGE_MS)
      fixture.seedRow("cycle-2", storedLegacyEnvelope("cycle-2"), FRESH_AGE_MS)
      val transport = RecordingDiagnosticsTransport { SyncDiagnosticsPostResult(400) }

      val result = drain(fixture, transport)

      // CONTRACT CORRECTION, not a weakened assertion: the shipped ladder treated every `400` as a
      // verdict about the body. A codeless `400` is a VERSION state instead -- a bridge predating
      // the refusal vocabulary answers the generic `400 {"error":"invalid request body"}` with no
      // `field` and no `code` -- so discarding on it destroyed the whole backlog, whose only copy is
      // this outbox, on first contact. The row is KEPT, the batch STOPS (the next row would be
      // refused identically) and no destruction counter moves.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 1), result)
      assertEquals(1, transport.posts.size)
      assertEquals(
        listOf("cycle-1" to storedLegacyEnvelope("cycle-1"), "cycle-2" to storedLegacyEnvelope("cycle-2")),
        fixture.telemetryEntries(),
      )
      assertNull(fixture.telemetryNotBefore())
    }
  }

  @Test
  fun `a declared non-recoverable code still destroys the row`() {
    // Every OTHER vocabulary member keeps the status verdict: those bytes are refused by every
    // build there will ever be, so keeping them would only strand them. The codes are literals.
    for (code in listOf("kind_malformed", "body_unreadable", "field_rejected")) {
      SyncEngineTestDatabase().use { fixture ->
        fixture.seedRow("cycle-1", storedLegacyEnvelope("cycle-1"), FRESH_AGE_MS)
        fixture.seedRow("cycle-2", storedLegacyEnvelope("cycle-2"), FRESH_AGE_MS)
        val transport = RecordingDiagnosticsTransport { index ->
          if (index == 0) {
            SyncDiagnosticsPostResult(400, refusalCode = code)
          } else {
            SyncDiagnosticsPostResult(200)
          }
        }

        val result = drain(fixture, transport)

        assertEquals(code, SyncDiagnosticsFlushResult(attempted = 2, delivered = 1, discarded = 1), result)
        assertEquals(code, emptyList<Pair<String, String>>(), fixture.telemetryEntries())
      }
    }
  }

  @Test
  fun `a declared recoverable code still parks and stops the batch`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedRow("cycle-1", storedLegacyEnvelope("cycle-1"), FRESH_AGE_MS)
      fixture.seedRow("cycle-2", storedLegacyEnvelope("cycle-2"), FRESH_AGE_MS)
      val transport = RecordingDiagnosticsTransport {
        SyncDiagnosticsPostResult(400, refusalCode = "kind_not_served")
      }

      val result = drain(fixture, transport)

      // The ONE recoverable member, checked BEFORE the permanence rule and written as a literal.
      // Those bytes are not wrong -- that build simply does not serve that kind -- so a forward roll
      // accepts every row kept here UNCHANGED. Destroying them would lose a backlog nothing else can
      // recover.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 1), result)
      assertEquals(1, transport.posts.size)
      assertEquals(
        listOf("cycle-1" to storedLegacyEnvelope("cycle-1"), "cycle-2" to storedLegacyEnvelope("cycle-2")),
        fixture.telemetryEntries(),
      )
    }
  }

  @Test
  fun `a 413 is permanent with or without a code`() {
    // Size is a property of the BYTES, and no build makes a body smaller: an oversize refusal stays
    // true for every bridge there will ever be, so it is the one status that never needs a code.
    for (code in listOf(null, "body_too_large")) {
      SyncEngineTestDatabase().use { fixture ->
        fixture.seedRow("cycle-1", storedLegacyEnvelope("cycle-1"), FRESH_AGE_MS)
        fixture.seedRow("cycle-2", storedLegacyEnvelope("cycle-2"), FRESH_AGE_MS)
        val transport = RecordingDiagnosticsTransport { index ->
          if (index == 0) {
            SyncDiagnosticsPostResult(413, refusalCode = code)
          } else {
            SyncDiagnosticsPostResult(200)
          }
        }

        val result = drain(fixture, transport)

        // Destroyed AND the batch continued: the row behind it may be perfectly deliverable.
        assertEquals("$code", SyncDiagnosticsFlushResult(attempted = 2, delivered = 1, discarded = 1), result)
        assertEquals("$code", emptyList<Pair<String, String>>(), fixture.telemetryEntries())
      }
    }
  }

  @Test
  fun `a 401 keeps the row and stops without inventing a wait`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedRow("cycle-1", storedLegacyEnvelope("cycle-1"), FRESH_AGE_MS)
      fixture.seedRow("cycle-2", storedLegacyEnvelope("cycle-2"), FRESH_AGE_MS)
      val transport = RecordingDiagnosticsTransport { SyncDiagnosticsPostResult(401) }

      val result = drain(fixture, transport)

      // `401` is written by the shared authentication layer, not the handler, so it declares no
      // code and the status owns the answer: retry, destroy nothing, invent no backoff.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 1), result)
      assertEquals(1, transport.posts.size)
      assertNull(fixture.telemetryNotBefore())
    }
  }

  @Test
  fun `a 400 whose body declares no readable code parks rather than destroying the row`() {
    // The real reader, the real transport, the real HTTP response: `rawBody` is the one field this
    // rule touches, and a body-level case that skipped the reader would pin nothing about it.
    for (body in listOf("""{"error":"invalid request body"}""", "{ not json", "", "null")) {
      SyncEngineTestDatabase().use { fixture ->
        fixture.seedRow("cycle-1", storedLegacyEnvelope("cycle-1"), FRESH_AGE_MS)
        fixture.seedRow("cycle-2", storedLegacyEnvelope("cycle-2"), FRESH_AGE_MS)
        SyncEngineTestHttpServer(400, body).use { server ->
          val result = drainAt(fixture, server.port)

          assertEquals(body, SyncDiagnosticsFlushResult(attempted = 1), result)
          assertEquals(body, 1, server.requests.size)
          assertEquals(
            body,
            listOf("cycle-1" to storedLegacyEnvelope("cycle-1"), "cycle-2" to storedLegacyEnvelope("cycle-2")),
            fixture.telemetryEntries(),
          )
          assertNull(body, fixture.telemetryNotBefore())
        }
      }
    }
  }

  @Test
  fun `a 400 whose body declares only blank whitespace parks rather than destroying the row`() {
    // CONTRACT CHANGE: this body used to DISCARD the row, because `"   "` read as a declared code.
    // A blank field names nothing, so nothing was declared about these bytes: the row parks exactly as
    // it does with no code at all, having still cost a request, so `attempted` moves and nothing else.
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedRow("cycle-1", storedLegacyEnvelope("cycle-1"), FRESH_AGE_MS)
      fixture.seedRow("cycle-2", storedLegacyEnvelope("cycle-2"), FRESH_AGE_MS)
      SyncEngineTestHttpServer(400, """{"code":"   "}""").use { server ->
        val result = drainAt(fixture, server.port)

        assertEquals(SyncDiagnosticsFlushResult(attempted = 1), result)
        assertEquals(1, server.requests.size)
        assertEquals(
          listOf("cycle-1" to storedLegacyEnvelope("cycle-1"), "cycle-2" to storedLegacyEnvelope("cycle-2")),
          fixture.telemetryEntries(),
        )
      }
    }
  }

  @Test
  fun `a 400 whose body declares the recoverable code parks through the real reader too`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedRow("cycle-1", storedLegacyEnvelope("cycle-1"), FRESH_AGE_MS)
      fixture.seedRow("cycle-2", storedLegacyEnvelope("cycle-2"), FRESH_AGE_MS)
      val bridgeBody =
        """{"error":"unknown kind \"x\"","code":"kind_not_served","field":"kind"}"""
      SyncEngineTestHttpServer(400, bridgeBody).use { server ->
        val result = drainAt(fixture, server.port)

        assertEquals(SyncDiagnosticsFlushResult(attempted = 1), result)
        assertEquals(1, server.requests.size)
        assertEquals(
          listOf("cycle-1" to storedLegacyEnvelope("cycle-1"), "cycle-2" to storedLegacyEnvelope("cycle-2")),
          fixture.telemetryEntries(),
        )
      }
    }
  }

  @Test
  fun `an unknown-kind park older than the bound is reaped and the batch carries on`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedRow(
        "stale-unknown-kind",
        """{"kind":"watch_session","phase":"received"}""",
        STALE_AGE_MS,
      )
      fixture.seedRow("cycle-route", storedLegacyEnvelope("cycle-route"), FRESH_AGE_MS)
      val transport = RecordingDiagnosticsTransport()

      val result = drain(fixture, transport)

      // The bound lands on how long this drain WAITS, never on whether the bytes are declared bad:
      // the park is retired, counted apart from both destructions, and the row behind it still goes
      // out -- the liveness the bound exists for, since a park occupies an oldest-first queue's head
      // on EVERY pass while the cap sheds the tail. `attempted` counts REQUESTS, not rows.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 1, delivered = 1, reaped = 1), result)
      assertEquals(listOf(storedLegacyEnvelope("cycle-route")), transport.posts.map { it.body })
      assertEquals(emptyList<Pair<String, String>>(), fixture.telemetryEntries())
    }
  }

  @Test
  fun `a codeless-400 park older than the bound is reaped and still stops the batch`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedRow("stale-refused", storedLegacyEnvelope("stale-refused"), STALE_AGE_MS)
      fixture.seedRow("cycle-2", storedLegacyEnvelope("cycle-2"), FRESH_AGE_MS)
      val transport = RecordingDiagnosticsTransport { SyncDiagnosticsPostResult(400) }

      val result = drain(fixture, transport)

      // The reap changes WHO removes the row and WHICH counter moves; it never re-decides what the
      // disposition decided. A codeless `400` still means the bridge is the wrong version: the batch
      // STOPS, the row behind it is not sent, `attempted` moved (this row WAS posted), no wait.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 1, reaped = 1), result)
      assertEquals(1, transport.posts.size)
      assertEquals(listOf("cycle-2" to storedLegacyEnvelope("cycle-2")), fixture.telemetryEntries())
      assertNull(fixture.telemetryNotBefore())
    }
  }

  @Test
  fun `the bound is strict -- a park at it waits, one millisecond past it both parks are reaped`() {
    for (ageMs in listOf(AT_BOUND_AGE_MS, OVER_BOUND_AGE_MS)) {
      SyncEngineTestDatabase().use { fixture ->
        // Identical ages, so the tie is broken by insertion order -- the same order the candidate
        // read uses -- which makes each pass deterministic: the park first, then the refusal.
        fixture.seedRow("unknown-kind", UNKNOWN_KIND_BODY, ageMs)
        fixture.seedRow("refused", storedLegacyEnvelope("refused"), ageMs)
        val transport = RecordingDiagnosticsTransport { SyncDiagnosticsPostResult(400) }
        val atTheBound = ageMs == AT_BOUND_AGE_MS
        val result = drain(fixture, transport)

        // STRICTLY greater or nothing. At exactly the declared age both rows stay inside the wait --
        // the park counted as the gap it is, the refused row keeping its place -- and one millisecond
        // later the BOUND moves them, not their bytes, which are identical either way. The codeless
        // `400` still stops the batch at both ages and no gate is written.
        val expectedResult = if (atTheBound) {
          SyncDiagnosticsFlushResult(attempted = 1, unclassified = 1)
        } else {
          SyncDiagnosticsFlushResult(attempted = 1, reaped = 2)
        }
        val expectedRows = if (atTheBound) {
          listOf("unknown-kind" to UNKNOWN_KIND_BODY, "refused" to storedLegacyEnvelope("refused"))
        } else {
          emptyList<Pair<String, String>>()
        }

        assertEquals("$ageMs", expectedResult, result)
        assertEquals("$ageMs", 1, transport.posts.size)
        assertEquals("$ageMs", expectedRows, fixture.telemetryEntries())
        assertNull("$ageMs", fixture.telemetryNotBefore())
      }
    }
  }

  @Test
  fun `no pending stop is ever reaped, however old the row is`() {
    // A year old and still PENDING, every one of them: the bridge is asking us to come back, or it
    // made the ONE refusal whose own rule is to keep the row and forward-roll it. The clock has no
    // authority over any of these, so `reaped` and `discarded` stay at zero, no gate is written, and
    // the row waits for the pass that follows a bridge which answers.
    val verdicts = listOf(
      SyncDiagnosticsPostResult(401),
      SyncDiagnosticsPostResult(404),
      SyncDiagnosticsPostResult(405),
      SyncDiagnosticsPostResult(408),
      SyncDiagnosticsPostResult(422),
      SyncDiagnosticsPostResult(429),
      SyncDiagnosticsPostResult(500),
      SyncDiagnosticsPostResult(400, refusalCode = "kind_not_served"),
    )
    for (verdict in verdicts) {
      SyncEngineTestDatabase().use { fixture ->
        fixture.seedRow("ancient", storedLegacyEnvelope("ancient"), YEAR_AGE_MS)
        fixture.seedRow("cycle-2", storedLegacyEnvelope("cycle-2"), YEAR_AGE_MS)
        val transport = RecordingDiagnosticsTransport { verdict }

        val result = drain(fixture, transport)

        assertEquals("$verdict", SyncDiagnosticsFlushResult(attempted = 1), result)
        assertEquals("$verdict", 1, transport.posts.size)
        assertEquals(
          "$verdict",
          listOf("ancient" to storedLegacyEnvelope("ancient"), "cycle-2" to storedLegacyEnvelope("cycle-2")),
          fixture.telemetryEntries(),
        )
        assertNull("$verdict", fixture.telemetryNotBefore())
      }
    }
  }

  @Test
  fun `an ancient but deliverable row is delivered, not reaped`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedRow("ancient-routable", storedLegacyEnvelope("ancient-routable"), YEAR_AGE_MS)
      val transport = RecordingDiagnosticsTransport()

      val result = drain(fixture, transport)

      // Eight days, a year, either way: the bound lands on how long we WAIT, never on the bytes, so
      // a row a bridge finally accepts is counted as the delivery it is.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 1, delivered = 1), result)
      assertEquals(emptyList<Pair<String, String>>(), fixture.telemetryEntries())
    }
  }

  @Test
  fun `reaped stays distinct from discarded in one mixed batch`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedRow("stale-unknown-kind", UNKNOWN_KIND_BODY, STALE_AGE_MS)
      fixture.seedRow("stale-refused", storedLegacyEnvelope("stale-refused"), STALE_AGE_MS)
      fixture.seedRow("cycle-fresh", storedLegacyEnvelope("cycle-fresh"), FRESH_AGE_MS)
      val transport = RecordingDiagnosticsTransport { index ->
        // The stale ROUTABLE row is answered with a declared non-recoverable code, so it leaves on
        // the BRIDGE's verdict: the counter a clock's removal must never absorb.
        if (index == 0) {
          SyncDiagnosticsPostResult(400, refusalCode = "field_rejected")
        } else {
          SyncDiagnosticsPostResult(200)
        }
      }

      val result = drain(fixture, transport)

      // Two removals in one pass and two counters: `reaped` moved because a CLOCK expired on a row
      // nothing had judged, `discarded` moved because the bridge condemned bytes it was asked about.
      // Folding either into the other would leave a non-zero `discarded` unable to say which happened.
      assertEquals(
        SyncDiagnosticsFlushResult(attempted = 2, delivered = 1, discarded = 1, reaped = 1),
        result,
      )
      assertEquals(2, transport.posts.size)
      assertEquals(emptyList<Pair<String, String>>(), fixture.telemetryEntries())
    }
  }

  @Test
  fun `a 413 declaring the recoverable code parks, because that check runs first`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedRow("cycle-1", storedLegacyEnvelope("cycle-1"), FRESH_AGE_MS)
      val transport = RecordingDiagnosticsTransport {
        SyncDiagnosticsPostResult(413, refusalCode = "kind_not_served")
      }

      val result = drain(fixture, transport)

      // The ONE exception, keyed on the refusal's own DECLARED meaning rather than on a status list:
      // `413` is permanent for every other body, but this refusal says the kind was never served, so
      // the bytes were never wrong: KEEP the row and STOP the batch, exactly as the JS drainer does.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 1), result)
      assertEquals(
        listOf("cycle-1" to storedLegacyEnvelope("cycle-1")),
        fixture.telemetryEntries(),
      )
    }
  }

  @Test
  fun `the permanence rule reads exactly two literal statuses`() {
    // Literals on both sides: the rule compares against 413 and 400, and so does this, so a mutated
    // status cannot leave the pair silently agreeing with itself.
    assertEquals(true, isPermanentDiagnosticsRejection(413, null))
    assertEquals(true, isPermanentDiagnosticsRejection(413, "body_too_large"))
    assertEquals(true, isPermanentDiagnosticsRejection(400, "kind_malformed"))
    assertEquals(false, isPermanentDiagnosticsRejection(400, null))
    for (status in listOf(401, 404, 405, 408, 422, 429, 500, 503)) {
      assertEquals("$status", false, isPermanentDiagnosticsRejection(status, null))
    }
  }

  @Test
  fun `the age bound and the recoverable code mirror their JS values`() {
    // The same two values now live in two languages with no shared artifact (see each constant's own
    // KDoc), so each mirror is asserted against the LITERAL rather than re-read: mutating either
    // Kotlin constant fails here, and the JS suite pins its half the same way.
    assertEquals(604_800_000L, SYNC_DIAGNOSTICS_PARKED_ROW_MAX_AGE_MS)
    assertEquals("kind_not_served", SYNC_DIAGNOSTICS_RECOVERABLE_REFUSAL_CODE)
  }

  @Test
  fun `the reap predicate is strict at the bound and reaches both park kinds only`() {
    val codeless400 = SyncDiagnosticsPostResult(code = 400, refusalCode = null)
    val routable = DiagnosticsPayloadKind.ROUTABLE
    val unclassified = DiagnosticsPayloadKind.UNCLASSIFIED

    // PARKED: an unnamed kind (never posted) and a routable row the bridge answered with a codeless
    // `400`. Both share the ONE bound, and exactly at it is still inside the wait -- so mutating the
    // constant in EITHER direction fails these four literals.
    assertEquals(false, shouldReapParkedDiagnosticsRow(unclassified, null, 604_800_000L))
    assertEquals(false, shouldReapParkedDiagnosticsRow(routable, codeless400, 604_800_000L))
    assertEquals(true, shouldReapParkedDiagnosticsRow(unclassified, null, 604_800_001L))
    assertEquals(true, shouldReapParkedDiagnosticsRow(routable, codeless400, 604_800_001L))

    // PENDING, however old: no verdict at all (a transport failure), the ONE declared recoverable
    // code, and every status the contract does not declare as permanent. No clock may destroy them.
    assertEquals(false, shouldReapParkedDiagnosticsRow(routable, null, YEAR_AGE_MS))
    assertEquals(
      false,
      shouldReapParkedDiagnosticsRow(
        routable,
        SyncDiagnosticsPostResult(code = 400, refusalCode = "kind_not_served"),
        YEAR_AGE_MS,
      ),
    )
    for (status in listOf(401, 404, 405, 408, 422, 429, 500, 503)) {
      val verdict = SyncDiagnosticsPostResult(code = status)
      assertEquals("$status", false, isParkedDiagnosticsRow(routable, verdict))
      assertEquals("$status", false, shouldReapParkedDiagnosticsRow(routable, verdict, YEAR_AGE_MS))
    }

    // A declaration never reaches the clock either, and the two park kinds answer `true` while a
    // routable row that was never refused does not.
    assertEquals(
      false,
      shouldReapParkedDiagnosticsRow(DiagnosticsPayloadKind.UNDELIVERABLE, null, YEAR_AGE_MS),
    )
    assertEquals(true, isParkedDiagnosticsRow(unclassified, null))
    assertEquals(false, isParkedDiagnosticsRow(routable, null))
  }

  /** Seeds one row [ageMs] old against this file's own clock. */
  private fun SyncEngineTestDatabase.seedRow(cycleId: String, payload: String, ageMs: Long) {
    seedTelemetryEntry(cycleId, payload, NOW_MS - ageMs)
  }

  /** Drains through a scripted in-process transport, so a case can name its own verdict. */
  private fun drain(
    fixture: SyncEngineTestDatabase,
    transport: SyncDiagnosticsTransport,
  ): SyncDiagnosticsFlushResult = SyncEngineDiagnosticsCourier(
    fixture.telemetryDatabaseFile,
    transport,
    { NOW_MS },
  ).drain(isSyncTelemetryEnabled = true, connection = CONNECTION)

  /**
   * Drains through the PRODUCTION transport against a loopback bridge, so the refusal code is read
   * off the wire by the same reader the device runs.
   */
  private fun drainAt(fixture: SyncEngineTestDatabase, port: Int): SyncDiagnosticsFlushResult =
    SyncEngineDiagnosticsCourier(fixture.telemetryDatabaseFile, now = { NOW_MS }).drain(
      isSyncTelemetryEnabled = true,
      connection = SyncDiagnosticsConnection(ip = "127.0.0.1", port = port.toString(), token = "token-1"),
    )

  private companion object {
    /** A realistic instant, this file's own: see the class KDoc for why it is not 1_000L. */
    const val NOW_MS = 1_700_000_000_000L

    /** An age no bound in this pipeline reaches: a row a pass just captured. */
    const val FRESH_AGE_MS = 60_000L

    /** LITERALS, one millisecond either side of the 7-day bound, and a clearly stale 8 days. */
    const val AT_BOUND_AGE_MS = 604_800_000L
    const val OVER_BOUND_AGE_MS = 604_800_001L
    const val STALE_AGE_MS = 691_200_000L
    const val YEAR_AGE_MS = 31_536_000_000L

    /** A declaration this build cannot name: never posted, so it is a PARK and not a pending row. */
    const val UNKNOWN_KIND_BODY = """{"kind":"watch_session","phase":"received"}"""

    val CONNECTION = SyncDiagnosticsConnection("127.0.0.1", "8080", "token-1")
  }
}
