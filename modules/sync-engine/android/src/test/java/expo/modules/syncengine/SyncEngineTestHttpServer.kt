package expo.modules.syncengine

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicReference

/** Bounded loopback HTTP responder for real sync-cycle tests. */
internal class SyncEngineTestHttpServer(
  private val statusCode: Int,
  private val responseBody: String,
  private val onRequestReceived: (Request) -> Unit = {},
) : AutoCloseable {
  data class Request(
    val method: String,
    val path: String,
    val headers: Map<String, String>,
    val body: String,
  )

  private val listener = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).apply {
    soTimeout = SOCKET_TIMEOUT_MS
  }
  private val acceptedSocket = AtomicReference<Socket?>()
  private val requestValue = AtomicReference<Request?>()
  private val workerFailure = AtomicReference<Throwable?>()
  private val worker = Thread({ serve() }, "sync-engine-test-http").apply {
    isDaemon = true
    start()
  }

  val port: Int get() = listener.localPort
  val request: Request get() = requestValue.get() ?: error("HTTP request was not received")

  private fun serve() {
    try {
      val socket = listener.accept().apply { acceptedSocket.set(this) }
      socket.use {
        val input = BufferedInputStream(socket.getInputStream())
        val deadline = System.nanoTime() + REQUEST_READ_DEADLINE_NS
        val requestLine = input.readHttpLine(socket, MAX_REQUEST_LINE_BYTES, deadline)
        val requestParts = requestLine.split(' ')
        check(requestParts.size == 3 && requestParts.all(String::isNotEmpty)) {
          "Invalid HTTP request line: $requestLine"
        }

        val headers = mutableMapOf<String, String>()
        var headerBytes = 0
        while (true) {
          val line = input.readHttpLine(socket, MAX_HEADER_LINE_BYTES, deadline)
          headerBytes += line.toByteArray(StandardCharsets.US_ASCII).size + CRLF_BYTES
          check(headerBytes <= MAX_HEADER_BYTES) { "HTTP request headers exceed $MAX_HEADER_BYTES bytes" }
          if (line.isEmpty()) break
          val separator = line.indexOf(':')
          check(separator > 0) { "Invalid HTTP header: $line" }
          headers[line.substring(0, separator).lowercase()] = line.substring(separator + 1).trim()
        }

        check(headers["transfer-encoding"] == null) { "Chunked test requests are not supported" }
        val contentLength = headers["content-length"]?.toIntOrNull()
          ?: error("Missing or invalid Content-Length")
        check(contentLength in 0..MAX_REQUEST_BODY_BYTES) {
          "HTTP request body exceeds $MAX_REQUEST_BODY_BYTES bytes"
        }
        val bodyBytes = input.readBoundedBody(socket, contentLength, deadline)
        val request = Request(
          method = requestParts[0],
          path = requestParts[1],
          headers = headers,
          body = String(bodyBytes, StandardCharsets.UTF_8),
        )
        requestValue.set(request)
        onRequestReceived(request)

        val responseBytes = responseBody.toByteArray(StandardCharsets.UTF_8)
        val output = BufferedOutputStream(socket.getOutputStream())
        output.write(
          ("HTTP/1.1 $statusCode ${reasonPhrase(statusCode)}\r\n" +
            "Content-Type: application/json\r\n" +
            "Content-Length: ${responseBytes.size}\r\nConnection: close\r\n\r\n")
            .toByteArray(StandardCharsets.US_ASCII),
        )
        output.write(responseBytes)
        output.flush()
      }
    } catch (error: Throwable) {
      if (!listener.isClosed) workerFailure.set(error)
    } finally {
      acceptedSocket.set(null)
    }
  }

  override fun close() {
    listener.close()
    worker.join(JOIN_TIMEOUT_MS)
    if (worker.isAlive) {
      acceptedSocket.getAndSet(null)?.close()
      worker.join(JOIN_TIMEOUT_MS)
    }
    check(!worker.isAlive) { "HTTP test server worker did not terminate" }
    workerFailure.get()?.let { throw AssertionError("HTTP test server failed", it) }
  }

  private fun reasonPhrase(code: Int): String = when (code) {
    200 -> "OK"
    400 -> "Bad Request"
    422 -> "Unprocessable Entity"
    500 -> "Internal Server Error"
    503 -> "Service Unavailable"
    else -> "Test Response"
  }

  private fun BufferedInputStream.readHttpLine(
    socket: Socket,
    maxBytes: Int,
    deadline: Long,
  ): String {
    val bytes = ByteArrayOutputStream()
    while (true) {
      val next = readWithinDeadline(socket, deadline)
      if (next == -1 || next == '\n'.code) break
      if (next != '\r'.code) {
        check(bytes.size() < maxBytes) { "HTTP line exceeds $maxBytes bytes" }
        bytes.write(next)
      }
    }
    return bytes.toString(StandardCharsets.US_ASCII.name())
  }

  private fun BufferedInputStream.readBoundedBody(
    socket: Socket,
    contentLength: Int,
    deadline: Long,
  ): ByteArray {
    val body = ByteArray(contentLength)
    var offset = 0
    while (offset < body.size) {
      val count = readWithinDeadline(socket, deadline, body, offset, body.size - offset)
      check(count != -1) { "HTTP request body ended before Content-Length bytes arrived" }
      offset += count
    }
    return body
  }

  private fun BufferedInputStream.readWithinDeadline(socket: Socket, deadline: Long): Int {
    setRemainingReadTimeout(socket, deadline)
    return read()
  }

  private fun BufferedInputStream.readWithinDeadline(
    socket: Socket,
    deadline: Long,
    bytes: ByteArray,
    offset: Int,
    length: Int,
  ): Int {
    setRemainingReadTimeout(socket, deadline)
    return read(bytes, offset, length)
  }

  private fun setRemainingReadTimeout(socket: Socket, deadline: Long) {
    val remainingNs = deadline - System.nanoTime()
    if (remainingNs <= 0) throw SocketTimeoutException("HTTP request exceeded overall read deadline")
    val remainingMs = ((remainingNs + NANOS_PER_MILLISECOND - 1) / NANOS_PER_MILLISECOND)
      .coerceAtMost(Int.MAX_VALUE.toLong())
    socket.soTimeout = remainingMs.toInt()
  }

  private companion object {
    const val SOCKET_TIMEOUT_MS = 2_000
    const val JOIN_TIMEOUT_MS = 2_500L
    const val REQUEST_READ_DEADLINE_NS = 2_000_000_000L
    const val MAX_REQUEST_LINE_BYTES = 8 * 1024
    const val MAX_HEADER_LINE_BYTES = 8 * 1024
    const val MAX_HEADER_BYTES = 32 * 1024
    const val MAX_REQUEST_BODY_BYTES = 1024 * 1024
    const val CRLF_BYTES = 2
    const val NANOS_PER_MILLISECOND = 1_000_000L
  }
}
