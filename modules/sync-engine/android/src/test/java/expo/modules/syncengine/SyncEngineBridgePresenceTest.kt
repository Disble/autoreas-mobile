package expo.modules.syncengine

import com.sun.net.httpserver.HttpServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * Plain-JUnit tests for [SyncEngineBridgePresence] against the pure `probe(config)` seam (ODD
 * native-foreground-sync-service testing pass). No Robolectric/Android dependency: the probe
 * only needs a [BridgeConfigRow] and issues [SyncEngineHttp.get] over [java.net.HttpURLConnection],
 * both plain JVM code, so a JDK [HttpServer] stands in for the bridge -- no new network
 * dependency, per the harness plan.
 */
class SyncEngineBridgePresenceTest {

  private var server: HttpServer? = null

  @After
  fun tearDown() {
    server?.stop(0)
    server = null
  }

  private fun startServer(): HttpServer {
    val srv = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    srv.executor = Executors.newCachedThreadPool()
    server = srv
    return srv
  }

  private fun config(
    port: Int,
    ip: String = "127.0.0.1",
    token: String? = "test-token",
    deviceId: String? = "device-1",
  ) = BridgeConfigRow(
    id = 1,
    deviceId = deviceId,
    ip = ip,
    port = port.toString(),
    token = token,
    lastChangelogId = null,
  )

  @Test
  fun `200 counts as presence and sends the exact GET contract`() {
    val requestCount = AtomicInteger(0)
    val method = AtomicReference<String?>()
    val path = AtomicReference<String?>()
    val authorization = AtomicReference<String?>()
    val contentType = AtomicReference<String?>()

    val srv = startServer()
    srv.createContext("/api/status") { exchange ->
      requestCount.incrementAndGet()
      method.set(exchange.requestMethod)
      path.set(exchange.requestURI.path)
      authorization.set(exchange.requestHeaders.getFirst("Authorization"))
      contentType.set(exchange.requestHeaders.getFirst("Content-Type"))
      exchange.sendResponseHeaders(200, -1)
      exchange.close()
    }
    srv.start()

    val result = SyncEngineBridgePresence.probe(config(port = srv.address.port, token = "abc123"))

    assertTrue(result.isPresent)
    assertNull(result.reason)
    assertEquals(1, requestCount.get())
    assertEquals("GET", method.get())
    assertEquals("/api/status", path.get())
    assertEquals("Bearer abc123", authorization.get())
    assertNull("a GET must never carry Content-Type", contentType.get())
  }

  @Test
  fun `401 still counts as presence -- any completed exchange is presence`() {
    val srv = startServer()
    srv.createContext("/api/status") { exchange ->
      exchange.sendResponseHeaders(401, -1)
      exchange.close()
    }
    srv.start()

    val result = SyncEngineBridgePresence.probe(config(port = srv.address.port))

    assertTrue(result.isPresent)
    assertNull(result.reason)
  }

  @Test
  fun `closed port is absence and names the transport exception class`() {
    // Bind then immediately close: the OS keeps this port free for us just long enough to be
    // certain nothing is listening on it, without depending on some fixed "surely unused" port.
    val socket = ServerSocket(0)
    val freePort = socket.localPort
    socket.close()

    val result = SyncEngineBridgePresence.probe(config(port = freePort))

    assertFalse(result.isPresent)
    assertEquals("ConnectException", result.reason)
  }

  @Test
  fun `a response delayed past the budget is absence within a bounded time`() {
    val latch = CountDownLatch(1)
    val srv = startServer()
    srv.createContext("/api/status") { exchange ->
      // Stands in for a bridge that accepted the TCP connection and then never answered. The
      // handler only unblocks once the test releases it below, well after the client already
      // gave up.
      latch.await(5, TimeUnit.SECONDS)
      exchange.sendResponseHeaders(200, -1)
      exchange.close()
    }
    srv.start()

    val startNanos = System.nanoTime()
    val result = SyncEngineBridgePresence.probe(config(port = srv.address.port))
    val elapsedMs = (System.nanoTime() - startNanos) / 1_000_000
    latch.countDown()

    assertFalse(result.isPresent)
    // Documented budget fact: SyncEngineHttp.get applies PRESENCE_PROBE_TIMEOUT_MS to the
    // connect phase and the read phase SEPARATELY (SyncEngineBridgePresence's "Known deviation"
    // class doc), so a bridge that accepts the connection and then hangs can cost up to
    // ~2x the nominal budget before the read times out. Here the connect is instant (the
    // server is already listening on localhost), so the whole call is bounded by one read
    // timeout; the 2x + margin bound is asserted anyway so this test documents the worst case,
    // not just the case it happens to exercise.
    assertTrue(
      "expected elapsed ($elapsedMs ms) to stay under 2x the presence timeout + margin",
      elapsedMs < 2 * PRESENCE_PROBE_TIMEOUT_MS + 1_000,
    )
  }

  @Test
  fun `missing config is absence without any HTTP request`() {
    val nullConfig: BridgeConfigRow? = null

    val result = SyncEngineBridgePresence.probe(nullConfig)

    assertFalse(result.isPresent)
    assertEquals("no bridge_config row", result.reason)
  }

  @Test
  fun `blank ip is absence without any HTTP request`() {
    val requestCount = AtomicInteger(0)
    val srv = startServer()
    srv.createContext("/api/status") { exchange ->
      requestCount.incrementAndGet()
      exchange.sendResponseHeaders(200, -1)
      exchange.close()
    }
    srv.start()

    // The live server is only here to PROVE zero requests reached it; a blank ip must refuse
    // before ever building a URL, so which port it happens to name is irrelevant.
    val result = SyncEngineBridgePresence.probe(config(ip = "", port = srv.address.port))

    assertFalse(result.isPresent)
    assertEquals(0, requestCount.get())
  }

  @Test
  fun `blank port is absence without any HTTP request`() {
    val result = SyncEngineBridgePresence.probe(
      BridgeConfigRow(id = 1, deviceId = "d", ip = "127.0.0.1", port = "", token = "t", lastChangelogId = null),
    )

    assertFalse(result.isPresent)
  }

  @Test
  fun `blank token is absence without any HTTP request`() {
    val requestCount = AtomicInteger(0)
    val srv = startServer()
    srv.createContext("/api/status") { exchange ->
      requestCount.incrementAndGet()
      exchange.sendResponseHeaders(200, -1)
      exchange.close()
    }
    srv.start()

    val result = SyncEngineBridgePresence.probe(config(port = srv.address.port, token = ""))

    assertFalse(result.isPresent)
    assertEquals(0, requestCount.get())
  }

  @Test
  fun `missing deviceId does not block the probe -- deviceId is not required`() {
    val srv = startServer()
    srv.createContext("/api/status") { exchange ->
      exchange.sendResponseHeaders(200, -1)
      exchange.close()
    }
    srv.start()

    val result = SyncEngineBridgePresence.probe(config(port = srv.address.port, deviceId = null))

    assertTrue(result.isPresent)
  }
}
