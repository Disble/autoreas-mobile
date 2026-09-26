package expo.modules.syncengine

import com.sun.net.httpserver.HttpServer
import java.io.BufferedOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Dedicated tests for [SyncEngineHttp] (T3, sync-core-test-assurance): before this file, it was
 * exercised only indirectly through [SyncEngineCycleTest] (`postJson`) and
 * [SyncEngineBridgePresenceTest] (`get`). Plain JUnit, no Robolectric: [SyncEngineHttp] only uses
 * `java.net.HttpURLConnection`, so a JDK [HttpServer] stands in for the bridge, same recipe as
 * [SyncEngineBridgePresenceTest].
 */
class SyncEngineHttpTest {

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

  // ---- postJson ----

  @Test
  fun `postJson sends the exact POST contract and reads a 2xx body from the input stream`() {
    var method: String? = null
    var path: String? = null
    var authorization: String? = null
    var contentType: String? = null
    var receivedBody: String? = null

    val srv = startServer()
    srv.createContext("/api/sync/reconcile") { exchange ->
      method = exchange.requestMethod
      path = exchange.requestURI.path
      authorization = exchange.requestHeaders.getFirst("Authorization")
      contentType = exchange.requestHeaders.getFirst("Content-Type")
      receivedBody = exchange.requestBody.readBytes().toString(StandardCharsets.UTF_8)
      val responseBytes = "{\"ok\":true}".toByteArray(StandardCharsets.UTF_8)
      exchange.sendResponseHeaders(200, responseBytes.size.toLong())
      exchange.responseBody.use { it.write(responseBytes) }
    }
    srv.start()

    val response = SyncEngineHttp.postJson(
      url = "http://127.0.0.1:${srv.address.port}/api/sync/reconcile",
      token = "tok-1",
      body = "{\"device_id\":\"d1\"}",
      timeoutMs = 5_000,
    )

    assertEquals(200, response.code)
    assertEquals("{\"ok\":true}", response.body)
    assertEquals("POST", method)
    assertEquals("/api/sync/reconcile", path)
    assertEquals("Bearer tok-1", authorization)
    assertEquals("application/json", contentType)
    assertEquals("{\"device_id\":\"d1\"}", receivedBody)
  }

  @Test
  fun `postJson reads a non-2xx body from the error stream`() {
    val srv = startServer()
    srv.createContext("/api/sync/reconcile") { exchange ->
      val responseBytes = "{\"error\":\"bad request\"}".toByteArray(StandardCharsets.UTF_8)
      exchange.sendResponseHeaders(400, responseBytes.size.toLong())
      exchange.responseBody.use { it.write(responseBytes) }
    }
    srv.start()

    val response = SyncEngineHttp.postJson(
      url = "http://127.0.0.1:${srv.address.port}/api/sync/reconcile",
      token = "tok-1",
      body = "{}",
      timeoutMs = 5_000,
    )

    assertEquals(400, response.code)
    assertEquals("{\"error\":\"bad request\"}", response.body)
  }

  @Test
  fun `postJson reports a null body when a non-2xx response carries no error stream`() {
    val srv = startServer()
    srv.createContext("/api/sync/reconcile") { exchange ->
      // 304 has no body by definition; HttpURLConnection#getErrorStream() reports null for a
      // non-2xx response with nothing to read, exercising the `stream?.let` null branch.
      exchange.sendResponseHeaders(304, -1)
      exchange.close()
    }
    srv.start()

    val response = SyncEngineHttp.postJson(
      url = "http://127.0.0.1:${srv.address.port}/api/sync/reconcile",
      token = "tok-1",
      body = "{}",
      timeoutMs = 5_000,
    )

    assertEquals(304, response.code)
    assertNull(response.body)
  }

  @Test
  fun `postJson reports a null body when the body stalls past the read timeout`() {
    // Headers arrive (so `connection.responseCode` succeeds and reaches readAll), but the
    // promised Content-Length bytes never do: readAll's BufferedReader#readText() blocks until
    // the read timeout fires a SocketTimeoutException, which `catch (Throwable) { null }` must
    // turn into a null body, never an escaping exception. Deterministic (unlike racing a TCP
    // RST against a graceful close, which this replaced: a `FixedLengthInputStream` in this JDK
    // tolerates an early clean close by returning the short body instead of throwing).
    val socket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val worker = Thread {
      socket.accept().use { conn ->
        val input = conn.getInputStream()
        val buffer = ByteArray(4096)
        var seenBlankLine = false
        val accumulated = StringBuilder()
        while (!seenBlankLine) {
          val read = input.read(buffer)
          if (read == -1) break
          accumulated.append(String(buffer, 0, read, StandardCharsets.US_ASCII))
          if (accumulated.contains("\r\n\r\n")) seenBlankLine = true
        }
        val out = BufferedOutputStream(conn.getOutputStream())
        out.write(
          "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n"
            .toByteArray(StandardCharsets.US_ASCII),
        )
        out.flush()
        // Never writes the body; keeps the connection open past the client's read timeout by
        // blocking here until the test's own client call has already returned.
        Thread.sleep(2_000)
      }
    }
    worker.isDaemon = true
    worker.start()

    try {
      val response = SyncEngineHttp.postJson(
        url = "http://127.0.0.1:${socket.localPort}/api/sync/reconcile",
        token = "tok-1",
        body = "{}",
        timeoutMs = 300,
      )

      assertEquals(200, response.code)
      assertNull("a stalled body must degrade to null, never throw", response.body)
    } finally {
      socket.close()
    }
  }

  // ---- get ----

  @Test
  fun `get sends the exact GET contract with no Content-Type and reads a 2xx body`() {
    var method: String? = null
    var authorization: String? = null
    var contentType: String? = null

    val srv = startServer()
    srv.createContext("/api/status") { exchange ->
      method = exchange.requestMethod
      authorization = exchange.requestHeaders.getFirst("Authorization")
      contentType = exchange.requestHeaders.getFirst("Content-Type")
      val responseBytes = "{\"status\":\"ok\"}".toByteArray(StandardCharsets.UTF_8)
      exchange.sendResponseHeaders(200, responseBytes.size.toLong())
      exchange.responseBody.use { it.write(responseBytes) }
    }
    srv.start()

    val response = SyncEngineHttp.get(
      url = "http://127.0.0.1:${srv.address.port}/api/status",
      token = "tok-2",
      timeoutMs = 5_000,
    )

    assertEquals(200, response.code)
    assertEquals("{\"status\":\"ok\"}", response.body)
    assertEquals("GET", method)
    assertEquals("Bearer tok-2", authorization)
    assertNull("a GET must never carry Content-Type", contentType)
  }

  @Test
  fun `get reads a non-2xx body from the error stream`() {
    val srv = startServer()
    srv.createContext("/api/status") { exchange ->
      val responseBytes = "unauthorized".toByteArray(StandardCharsets.UTF_8)
      exchange.sendResponseHeaders(401, responseBytes.size.toLong())
      exchange.responseBody.use { it.write(responseBytes) }
    }
    srv.start()

    val response = SyncEngineHttp.get(
      url = "http://127.0.0.1:${srv.address.port}/api/status",
      token = "tok-2",
      timeoutMs = 5_000,
    )

    assertEquals(401, response.code)
    assertEquals("unauthorized", response.body)
  }

  @Test
  fun `get reports a null body when a non-2xx response carries no error stream`() {
    val srv = startServer()
    srv.createContext("/api/status") { exchange ->
      exchange.sendResponseHeaders(304, -1)
      exchange.close()
    }
    srv.start()

    val response = SyncEngineHttp.get(
      url = "http://127.0.0.1:${srv.address.port}/api/status",
      token = "tok-2",
      timeoutMs = 5_000,
    )

    assertEquals(304, response.code)
    assertNull(response.body)
  }

  @Test
  fun `postJson reads an informational response code from the error stream branch`() {
    // A code below 200 makes the `code in 200..299` check's lower bound fail -- every other
    // test here uses a code already >= 200, leaving that specific comparison's false side dark.
    val srv = startServer()
    srv.createContext("/api/sync/reconcile") { exchange ->
      exchange.sendResponseHeaders(102, -1)
      exchange.close()
    }
    srv.start()

    val response = SyncEngineHttp.postJson(
      url = "http://127.0.0.1:${srv.address.port}/api/sync/reconcile",
      token = "tok-1",
      body = "{}",
      timeoutMs = 5_000,
    )

    assertEquals(102, response.code)
  }

  @Test
  fun `get reads an informational response code from the error stream branch`() {
    val srv = startServer()
    srv.createContext("/api/status") { exchange ->
      exchange.sendResponseHeaders(102, -1)
      exchange.close()
    }
    srv.start()

    val response = SyncEngineHttp.get(
      url = "http://127.0.0.1:${srv.address.port}/api/status",
      token = "tok-2",
      timeoutMs = 5_000,
    )

    assertEquals(102, response.code)
  }

  @Test
  fun `get honors the caller-provided timeout budget`() {
    val socket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    // Never accepted: the connect phase itself must time out within roughly the given budget.
    try {
      val startNanos = System.nanoTime()
      try {
        SyncEngineHttp.get(
          url = "http://127.0.0.1:${socket.localPort}/api/status",
          token = "tok-2",
          timeoutMs = 300,
        )
      } catch (expected: java.net.SocketTimeoutException) {
        val elapsedMs = (System.nanoTime() - startNanos) / 1_000_000
        assertTrue("expected a bounded wait, was ${elapsedMs}ms", elapsedMs < 5_000)
      }
    } finally {
      socket.close()
    }
  }
}
