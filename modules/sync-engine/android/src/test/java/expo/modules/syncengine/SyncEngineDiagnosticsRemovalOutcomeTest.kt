package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/** One stored legacy cycle envelope: the kindless body the bridge's frozen rule still accepts. */
private fun storedLegacyCycleEnvelope(cycleId: String): String = """{"cycle_id":"$cycleId"}"""

/** A declaration this build cannot name: never posted, so it is a PARK rather than a pending row. */
private const val UNNAMED_KIND_BODY = """{"kind":"watch_session","phase":"received"}"""

/**
 * The removal OUTCOME's authority over the counter: a removal counts as the disposition the ladder
 * reached only when the store CONFIRMS it, and as `failedRemovals` when it does not.
 *
 * `SyncEngineDiagnosticsCourier.drain` removes a stored row in five places, and this file pins the
 * four that are not the `2xx` path -- the `UNDELIVERABLE` destruction, the permanence destruction,
 * and the two REAPs the age bound authorises. The rule those four owe is the `2xx` path's own
 * (`if (outbox.remove(id)) delivered += 1 else failedRemovals += 1`), and the reason is not
 * symmetry: `remove` answers `false` only when the DELETE did not run
 * ([SyncEngineDiagnosticsOutbox.remove]), so the row is STILL STORED and still in the pass that
 * follows. Counting it as `undeliverable`, `discarded` or `reaped` would report a loss, a
 * destruction or a retirement the device never performed -- and a `reaped` in particular would
 * report the one thing the bound is there to detect as FIXED, since the row keeps occupying the head
 * of an oldest-first queue on every later pass.
 *
 * Every case here is necessarily SYNTHETIC, and the shape is the only one reachable: the courier
 * constructs its own [SyncEngineDiagnosticsOutbox] from the telemetry file, so there is no seam to
 * inject a store and no write of the fixture's own that could make one removal fail. A
 * `BEFORE DELETE` trigger that ABORTS is that state -- the DELETE cannot run, the candidate read is
 * untouched, and the rest of the pass stays observable instead of merely assumed. The assertion that
 * the rows are still stored is what proves the trigger bit, so the pass cannot silently be testing a
 * store that removed the row anyway.
 *
 * Kept apart from `SyncEngineDiagnosticsCourierTest` and `SyncEngineDiagnosticsReapTest` because both
 * sit at the repository's 500-line ceiling, the same reason `SyncEngineDiagnosticsReapTest` itself
 * was created. It is not hosted in the outbox suite either: those cases are about the STORE, while
 * these are about the COURIER's accounting OF the store's answer.
 *
 * Every age, status and refusal code below is a LITERAL, computed from no production constant, so a
 * mutated constant cannot leave the code and its test silently agreeing with each other.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineDiagnosticsRemovalOutcomeTest {

  @Test
  fun `an unconfirmed declaration destruction is a failed removal and the batch continues`() {
    SyncEngineTestDatabase().use { fixture ->
      val retired = """{"cycle_id":"cycle-retired","kind":"retired_kind"}"""
      fixture.seedTelemetryEntry("cycle-retired", retired, 10L)
      // Just captured, so the park behind the destroyed row is FRESH: only the bound may retire a
      // park, and this case is about the destruction's counter rather than about the clock.
      fixture.seedTelemetryEntry("cycle-parked", UNNAMED_KIND_BODY, NOW_MS)
      abortTelemetryDeletes(fixture)
      val transport = RecordingDiagnosticsTransport()

      val result = drain(fixture, transport, undeliverableKinds = setOf("retired_kind"))

      // `unclassified` is this case's evidence that the UNCONFIRMED destruction still CONTINUED the
      // batch: the parked row behind it was read and counted. No request was spent, since neither a
      // declaration nor a park is posted, and `undeliverable` stays empty because no destruction
      // happened -- the row is right there in the outbox.
      assertEquals(SyncDiagnosticsFlushResult(failedRemovals = 1, unclassified = 1), result)
      assertEquals(0, transport.posts.size)
      assertEquals(
        listOf("cycle-retired" to retired, "cycle-parked" to UNNAMED_KIND_BODY),
        fixture.telemetryEntries(),
      )
    }
  }

  @Test
  fun `an unconfirmed permanence destruction is a failed removal and the batch continues`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("cycle-413", storedLegacyCycleEnvelope("cycle-413"), 10L)
      fixture.seedTelemetryEntry("cycle-parked", UNNAMED_KIND_BODY, NOW_MS)
      abortTelemetryDeletes(fixture)
      val transport = RecordingDiagnosticsTransport { SyncDiagnosticsPostResult(413) }

      val result = drain(fixture, transport)

      // A `413` is the bridge's own permanence declaration, so the row is destroyed on the verdict --
      // except that the store did not confirm it. The verdict still owns the BATCH: the parked row
      // behind it was read, so the pass continued, and the counter that moved is the removal's.
      assertEquals(
        SyncDiagnosticsFlushResult(attempted = 1, failedRemovals = 1, unclassified = 1),
        result,
      )
      assertEquals(1, transport.posts.size)
      assertEquals(
        listOf(
          "cycle-413" to storedLegacyCycleEnvelope("cycle-413"),
          "cycle-parked" to UNNAMED_KIND_BODY,
        ),
        fixture.telemetryEntries(),
      )
    }
  }

  @Test
  fun `an unconfirmed reap of an unnamed-kind park is a failed removal and the batch continues`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry("stale-unnamed", UNNAMED_KIND_BODY, NOW_MS - STALE_AGE_MS)
      fixture.seedTelemetryEntry("fresh-unnamed", """{"kind":"other_session"}""", NOW_MS)
      abortTelemetryDeletes(fixture)
      val transport = RecordingDiagnosticsTransport()

      val result = drain(fixture, transport)

      // The age bound moved the first row, not its bytes, and the store's refusal to confirm the
      // removal is the answer that decides the counter: `reaped` would claim a retirement this pass
      // did not perform while the row sits at the head of the queue. The second park is `unclassified`
      // rather than a POST, which is how this case proves the batch CARRIED ON past the first row --
      // that is the park's own decision, and no removal may take it away.
      assertEquals(SyncDiagnosticsFlushResult(failedRemovals = 1, unclassified = 1), result)
      assertEquals(0, transport.posts.size)
      assertEquals(
        listOf(
          "stale-unnamed" to UNNAMED_KIND_BODY,
          "fresh-unnamed" to """{"kind":"other_session"}""",
        ),
        fixture.telemetryEntries(),
      )
    }
  }

  @Test
  fun `an unconfirmed reap of a codeless-400 park is a failed removal and the batch still stops`() {
    SyncEngineTestDatabase().use { fixture ->
      fixture.seedTelemetryEntry(
        "stale-refused",
        storedLegacyCycleEnvelope("stale-refused"),
        NOW_MS - STALE_AGE_MS,
      )
      fixture.seedTelemetryEntry("cycle-behind", storedLegacyCycleEnvelope("cycle-behind"), NOW_MS)
      abortTelemetryDeletes(fixture)
      val transport = RecordingDiagnosticsTransport { SyncDiagnosticsPostResult(400) }

      val result = drain(fixture, transport)

      // The codeless `400` means the bridge is the wrong version, and the reap replaces only WHICH
      // removal happens: the batch still STOPS, which one request is the whole proof of here. The
      // reap's own removal was unconfirmed, so `reaped` stays empty and the row stays queued for the
      // pass that follows a bridge which answers.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 1, failedRemovals = 1), result)
      assertEquals(1, transport.posts.size)
      assertEquals(
        listOf(
          "stale-refused" to storedLegacyCycleEnvelope("stale-refused"),
          "cycle-behind" to storedLegacyCycleEnvelope("cycle-behind"),
        ),
        fixture.telemetryEntries(),
      )
    }
  }

  /**
   * Makes every removal in the pass UNCONFIRMED: the trigger aborts the DELETE, so
   * [SyncEngineDiagnosticsOutbox.remove] answers `false` while the candidate read still works.
   *
   * This is the only reachable shape of that state -- see the class KDoc -- and it is deliberately
   * narrower than "a store that fails": the fixture's rows, schema and gate are untouched, so what
   * each case observes is the drain's accounting of the store's answer, not a broken database.
   */
  private fun abortTelemetryDeletes(fixture: SyncEngineTestDatabase) {
    fixture.openTelemetryOutbox().execSQL(
      "CREATE TRIGGER abort_telemetry_delete BEFORE DELETE ON sync_diagnostics_outbox " +
        "BEGIN SELECT RAISE(ABORT, 'unconfirmed removal'); END",
    )
  }

  /** Drains one batch through a scripted in-process transport, with this file's own clock. */
  private fun drain(
    fixture: SyncEngineTestDatabase,
    transport: SyncDiagnosticsTransport,
    undeliverableKinds: Set<String> = emptySet(),
  ): SyncDiagnosticsFlushResult = SyncEngineDiagnosticsCourier(
    telemetryFile = fixture.telemetryDatabaseFile,
    transport = transport,
    now = { NOW_MS },
    undeliverableKinds = undeliverableKinds,
  ).drain(isSyncTelemetryEnabled = true, connection = CONNECTION)

  private companion object {
    /** A realistic instant, so every age below is an ordinary positive epoch millis. */
    const val NOW_MS = 1_700_000_000_000L

    /** Eight days: a full day clear of the seven-day bound, whose value this file never re-reads. */
    const val STALE_AGE_MS = 691_200_000L

    val CONNECTION = SyncDiagnosticsConnection("127.0.0.1", "8080", "token-1")
  }
}
