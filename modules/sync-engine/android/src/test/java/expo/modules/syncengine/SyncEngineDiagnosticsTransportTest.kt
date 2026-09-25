package expo.modules.syncengine

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The native diagnostics transport and its two response readers: `Retry-After` and the refusal
 * `code`.
 *
 * ROBOLECTRIC, not the plain JUnit this file used to need: the refusal `code` is read through
 * `org.json`, and AGP's `returnDefaultValues = true` puts its mockable stub FIRST on the
 * plain-JUnit classpath, where `JSONObject("{\"code\":\"kind_not_served\"}")` answers an empty
 * object instead of throwing -- so every refusal-code assertion here passed as `null` while looking
 * like a real read. Robolectric supplies the real `org.json` implementation the device runs, which is
 * the only classpath where these assertions are about the reader instead of about the stub. The
 * `java.net` socket seam is unchanged by it.
 */
@RunWith(RobolectricTestRunner::class)
class SyncEngineDiagnosticsTransportTest {

  @Test
  fun `posts the stored payload verbatim with the bridge header contract`() {
    SyncEngineTestHttpServer(200, """{"status":"ok"}""").use { server ->
      val payload = """{"cycle_id":"cycle-1", "kind" : null, "note":"acentué"}"""

      val result = HttpSyncDiagnosticsTransport.post(
        url = "http://127.0.0.1:${server.port}$SYNC_DIAGNOSTICS_PATH",
        token = "token-1",
        body = payload,
        timeoutMs = SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS,
      )

      assertEquals(SyncDiagnosticsPostResult(200, null), result)
      assertEquals("POST", server.request.method)
      assertEquals("/api/sync/diagnostics", server.request.path)
      assertEquals("Bearer token-1", server.request.headers["authorization"])
      assertTrue(server.request.headers["content-type"].orEmpty().startsWith("application/json"))
      assertEquals("The stored payload must reach the wire byte for byte", payload, server.request.body)
    }
  }

  @Test
  fun `reads a delta seconds retry after header`() {
    SyncEngineTestHttpServer.scripted(
      listOf(
        SyncEngineTestHttpServer.Response(429, """{"error":"slow down"}""", mapOf("Retry-After" to "120")),
      ),
    ).use { server ->
      val result = postTo(server.port)

      assertEquals(429, result.code)
      assertEquals(120_000L, result.retryAfterMillis)
    }
  }

  @Test
  fun `reads an http date retry after header and nothing when it is absent`() {
    SyncEngineTestHttpServer.scripted(
      listOf(
        SyncEngineTestHttpServer.Response(
          429,
          """{"error":"slow down"}""",
          mapOf("Retry-After" to "Sun, 06 Nov 1994 08:49:37 GMT"),
        ),
      ),
    ).use { server ->
      assertEquals(0L, postTo(server.port).retryAfterMillis)
    }

    SyncEngineTestHttpServer.scripted(
      listOf(SyncEngineTestHttpServer.Response(503, """{"error":"later"}""")),
    ).use { server ->
      val result = postTo(server.port)

      assertEquals(503, result.code)
      assertEquals(null, result.retryAfterMillis)
    }
  }

  @Test
  fun `maps every retry after shape onto a bounded delay`() {
    val now = 1_700_000_000_000L

    assertEquals(null, parseRetryAfterMillis(null, now))
    assertEquals(null, parseRetryAfterMillis("", now))
    assertEquals(null, parseRetryAfterMillis("   ", now))
    assertEquals(null, parseRetryAfterMillis("soon", now))
    assertEquals(null, parseRetryAfterMillis("-5", now))
    assertEquals(null, parseRetryAfterMillis("1.5", now))
    assertEquals(null, parseRetryAfterMillis("12:00", now))
    assertEquals(0L, parseRetryAfterMillis("0", now))
    assertEquals(120_000L, parseRetryAfterMillis("120", now))
    assertEquals(120_000L, parseRetryAfterMillis(" 120 ", now))
    assertEquals(SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS, parseRetryAfterMillis("3600", now))
    assertEquals(SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS, parseRetryAfterMillis("3601", now))
    assertEquals(
      "A delta-seconds value too large for a Long must clamp, never wrap",
      SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS,
      parseRetryAfterMillis("99999999999999999999", now),
    )
    // HTTP-date forms are defensive: the bridge contract sends delta-seconds. A past date is
    // "retry now" (0), and a far-future one clamps at the same bound as delta-seconds.
    assertEquals(120_000L, parseRetryAfterMillis(httpDate(now + 120_000L), now))
    assertEquals(SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS, parseRetryAfterMillis(httpDate(now + 7_200_000L), now))
    assertEquals(0L, parseRetryAfterMillis("Sun, 06 Nov 1994 08:49:37 GMT", now))
    assertEquals(0L, parseRetryAfterMillis("Sunday, 06-Nov-94 08:49:37 GMT", now))
    assertEquals(0L, parseRetryAfterMillis("Sun Nov  6 08:49:37 1994", now))
  }

  @Test
  fun `carries the refusal code an error body declares and never invents one`() {
    SyncEngineTestHttpServer(400, """{"error":"unknown kind","code":"kind_not_served","field":"kind"}""").use { server ->
      val result = postTo(server.port)

      assertEquals(400, result.code)
      assertEquals("kind_not_served", result.refusalCode)
      assertEquals(null, result.retryAfterMillis)
    }

    // The auth-layer 401 and any bridge older than the discriminated endpoint declare no `code`:
    // the read answers null for every body it cannot read, and the status keeps the verdict.
    SyncEngineTestHttpServer(400, """{"error":"invalid request body"}""").use { server ->
      assertEquals(null, postTo(server.port).refusalCode)
    }
  }

  @Test
  fun `answers null rather than throwing for every body that declares no code`() {
    assertEquals(
      "kind_not_served",
      readDiagnosticsRefusalCode("""{"code":"kind_not_served"}"""),
    )
    assertEquals(null, readDiagnosticsRefusalCode(null))
    assertEquals(null, readDiagnosticsRefusalCode(""))
    assertEquals(null, readDiagnosticsRefusalCode("not json"))
    assertEquals(null, readDiagnosticsRefusalCode("[1,2,3]"))
    assertEquals(null, readDiagnosticsRefusalCode("\"kind_not_served\""))
    assertEquals(null, readDiagnosticsRefusalCode("null"))
    assertEquals(null, readDiagnosticsRefusalCode("42"))
    assertEquals(null, readDiagnosticsRefusalCode("""{"code":42}"""))
    assertEquals(null, readDiagnosticsRefusalCode("""{"code":null}"""))
    assertEquals(null, readDiagnosticsRefusalCode("""{"code":{"nested":true}}"""))
  }

  private fun postTo(port: Int): SyncDiagnosticsPostResult = HttpSyncDiagnosticsTransport.post(
    url = "http://127.0.0.1:$port$SYNC_DIAGNOSTICS_PATH",
    token = "token-1",
    body = """{"cycle_id":"cycle-1"}""",
    timeoutMs = SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS,
  )

  /** Renders one instant in the IMF-fixdate form an HTTP `Retry-After` date header uses. */
  private fun httpDate(epochMillis: Long): String =
    SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US)
      .apply { timeZone = TimeZone.getTimeZone("GMT") }
      .format(Date(epochMillis))
}
