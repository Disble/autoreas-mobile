package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * The DEFAULT accepted-kind registry, exercised through the production courier a background drain
 * builds rather than through a set the test hands in.
 *
 * `SyncEngineDiagnosticsCourierTest` pins the classification SEAM by injecting `acceptedKinds`, and
 * that file is at the repository's 500-line ceiling. An injected set proves only that the set the
 * test passed is honoured -- it cannot prove the registry the DEVICE ships, which is the whole
 * parity defect this file closes: the JS drainer accepted `episode_action` while the native courier
 * still used an empty registry, so a background-native delivery parked every episode row and the
 * seven-day age bound could reap them. Every drain below therefore constructs the courier with NO
 * `acceptedKinds` argument, which is exactly what production does.
 *
 * The constants are asserted against literals, and the payload kinds are literals, so a drift in
 * either direction fails here instead of silently parking a deliverable backlog.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineDiagnosticsAcceptedKindsTest {

  @Test
  fun `the default registry names exactly the kind the bridge serves and destroys nothing`() {
    // The JS mirror is `[undefined, 'episode_action']`. The `undefined` entry identifies the
    // ABSENCE of the `kind` key, which JSON cannot represent and which `classifyDiagnosticsPayload`
    // handles where it reads instead -- see the kindless delivery case below. Destruction stays
    // EMPTY: no kind is positively declared unsatisfiable, because registry absence is not one.
    assertEquals(setOf("episode_action"), SYNC_DIAGNOSTICS_ACCEPTED_KINDS)
    assertEquals(emptySet<String>(), SYNC_DIAGNOSTICS_UNDELIVERABLE_KINDS)
  }

  @Test
  fun `the production courier posts an episode action row instead of parking it`() {
    SyncEngineTestDatabase().use { fixture ->
      val payload = """{"cycle_id":"cycle-episode","kind":"episode_action"}"""
      fixture.seedTelemetryEntry("cycle-episode", payload, 10L)
      val transport = RecordingDiagnosticsTransport()

      val result = SyncEngineDiagnosticsCourier(
        telemetryFile = fixture.telemetryDatabaseFile,
        transport = transport,
        now = { NOW_MS },
      ).drain(isSyncTelemetryEnabled = true, connection = CONNECTION)

      // Delivered, not PARKED: the row leaves the outbox only after the bridge answered 2xx, and it
      // reaches the wire byte-for-byte, so the registry flip changes routing and nothing else.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 1, delivered = 1), result)
      assertEquals(listOf(payload), transport.posts.map { it.body })
      assertEquals(emptyList<Pair<String, String>>(), fixture.telemetryEntries())
    }
  }

  @Test
  fun `the default registry still parks a kind it does not name`() {
    SyncEngineTestDatabase().use { fixture ->
      val stored = """{"cycle_id":"cycle-unknown","kind":"watch_session"}"""
      fixture.seedTelemetryEntry("cycle-unknown", stored, 10L)
      fixture.seedTelemetryEntry("cycle-legacy", legacyBody("cycle-legacy"), 20L)
      val transport = RecordingDiagnosticsTransport()

      val result = SyncEngineDiagnosticsCourier(
        telemetryFile = fixture.telemetryDatabaseFile,
        transport = transport,
        now = { NOW_MS },
      ).drain(isSyncTelemetryEnabled = true, connection = CONNECTION)

      // The registry's OTHER side: an unnamed kind belongs to another build of the app, so it is
      // never posted and never deleted, and -- the point of parking rather than stopping -- the
      // batch CONTINUES so the deliverable legacy row behind it still goes out.
      assertEquals(
        SyncDiagnosticsFlushResult(attempted = 1, delivered = 1, unclassified = 1),
        result,
      )
      assertEquals(listOf(legacyBody("cycle-legacy")), transport.posts.map { it.body })
      assertEquals(listOf("cycle-unknown" to stored), fixture.telemetryEntries())
    }
  }

  @Test
  fun `a kindless legacy envelope still delivers off the default registry`() {
    SyncEngineTestDatabase().use { fixture ->
      val payload = legacyBody("cycle-legacy")
      fixture.seedTelemetryEntry("cycle-legacy", payload, 10L)
      val transport = RecordingDiagnosticsTransport()

      val result = SyncEngineDiagnosticsCourier(
        telemetryFile = fixture.telemetryDatabaseFile,
        transport = transport,
        now = { NOW_MS },
      ).drain(isSyncTelemetryEnabled = true, connection = CONNECTION)

      // The ABSENCE of the `kind` key is the deployed cycle report's frozen compatibility rule, and
      // it must keep delivering no matter what the named registry holds: this is the entry the JS
      // `[undefined, ...]` member corresponds to, handled at the point of reading rather than by a
      // named token a JSON body could ever carry.
      assertEquals(SyncDiagnosticsFlushResult(attempted = 1, delivered = 1), result)
      assertEquals(listOf(payload), transport.posts.map { it.body })
      assertEquals(emptyList<Pair<String, String>>(), fixture.telemetryEntries())
    }
  }

  /** One kindless legacy cycle envelope: the shape the bridge's frozen rule accepts. */
  private fun legacyBody(cycleId: String): String = """{"cycle_id":"$cycleId"}"""

  private companion object {
    const val NOW_MS = 1_000L
    val CONNECTION = SyncDiagnosticsConnection("127.0.0.1", "8080", "token-1")
  }
}
