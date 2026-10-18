package expo.modules.syncengine

import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

private const val TAG = "SyncEngineHttp"

/**
 * One completed bridge HTTP exchange: status code, the body actually received, and the raw
 * `Retry-After` header (read only by the diagnostics courier's not-before gate).
 */
data class SyncEngineHttpResponse(
  val code: Int,
  val body: String?,
  val retryAfter: String? = null,
)

/**
 * One completed binary `GET` (the cover download): status code, the raw body of a `200` (null for
 * every other status), and the verbatim `ETag` header, which names the cover's on-disk file.
 */
class SyncEngineBinaryResponse(
  val code: Int,
  val bytes: ByteArray?,
  val etag: String?,
)

/**
 * The native engine's one exit to the bridge (ADR 009 R-2): every request the `:sync` process
 * makes leaves through here. [postJson] issues the reconcile and diagnostics `POST`s with a JSON
 * body and the caller's connect/read budget (10 s, `BRIDGE_REQUEST_TIMEOUT_MS`, for reconcile);
 * [get] issues the bodyless `GET`s (the presence probe, the fetch-first token read, the active
 * season) with their own budgets; [getBytes] downloads a cover. Deliberately uses `HttpURLConnection` — no new dependency on the sync path.
 *
 * Transport failures throw; callers ([SyncEngineCycle], [SyncEngineBridgePresence],
 * [HttpSyncDiagnosticsTransport]) own mapping them onto their own outcome.
 *
 * Both methods take an optional `requestId`: a request made inside a sync attempt passes the
 * attempt's next [RequestIdSequence] value and it is sent as [REQUEST_ID_HEADER]; without one,
 * no such header is set and the request's headers stay exactly what they were before it existed.
 */
object SyncEngineHttp {

  /**
   * Issues one POST and reads the response body from whichever stream the status code makes
   * readable (2xx from the input stream, errors from the error stream), so a bridge error body
   * survives for the failure reason. [requestId], when given, is sent as [REQUEST_ID_HEADER].
   */
  fun postJson(
    url: String,
    token: String,
    body: String,
    timeoutMs: Int,
    requestId: String? = null,
  ): SyncEngineHttpResponse {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.requestMethod = "POST"
    connection.connectTimeout = timeoutMs
    connection.readTimeout = timeoutMs
    connection.doOutput = true
    connection.setRequestProperty("Content-Type", "application/json")
    connection.setRequestProperty("Authorization", "Bearer $token")
    stampRequestId(connection, requestId)

    try {
      connection.outputStream.use { output ->
        output.write(body.toByteArray(Charsets.UTF_8))
        output.flush()
      }
      val code = connection.responseCode
      val stream = if (code in 200..299) connection.inputStream else connection.errorStream
      return SyncEngineHttpResponse(
        code = code,
        body = stream?.let { readAll(it) },
        retryAfter = connection.getHeaderField("Retry-After"),
      )
    } finally {
      connection.disconnect()
    }
  }

  /**
   * Issues one `GET` with bearer auth and no request body, honoring a caller-provided
   * connect/read budget. Mirrors the presence probe's header shape (`buildBridgeHeaders({
   * hasBody: false, token })` in `bridge-url.helpers.ts`): only `Authorization`, never
   * `Content-Type` -- a GET never carries a body, so stamping one would diverge from the JS
   * probe this method exists to replicate. Reads the body from whichever stream the status
   * code makes readable, same rule as [postJson], though [SyncEngineBridgePresence] only cares
   * whether this call returns at all: ANY status code is a normal return (presence), and only a
   * thrown transport failure (timeout, refused connection, DNS failure) is absence. [requestId],
   * when given, is sent as [REQUEST_ID_HEADER].
   */
  fun get(
    url: String,
    token: String,
    timeoutMs: Int,
    requestId: String? = null,
  ): SyncEngineHttpResponse {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.requestMethod = "GET"
    connection.connectTimeout = timeoutMs
    connection.readTimeout = timeoutMs
    connection.setRequestProperty("Authorization", "Bearer $token")
    stampRequestId(connection, requestId)

    return try {
      val code = connection.responseCode
      val stream = if (code in 200..299) connection.inputStream else connection.errorStream
      SyncEngineHttpResponse(code, stream?.let { readAll(it) })
    } finally {
      connection.disconnect()
    }
  }

  /**
   * Issues one bodyless `GET` with bearer auth and reads a `200` body as raw bytes, the way the JS
   * `getAnimeCover` does: only a `200` carries an image, so every other status returns no body.
   */
  fun getBytes(
    url: String,
    token: String,
    timeoutMs: Int,
  ): SyncEngineBinaryResponse {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.requestMethod = "GET"
    connection.connectTimeout = timeoutMs
    connection.readTimeout = timeoutMs
    connection.setRequestProperty("Authorization", "Bearer $token")

    return try {
      val code = connection.responseCode
      val bytes = if (code == 200) connection.inputStream.use { it.readBytes() } else null
      SyncEngineBinaryResponse(code, bytes, connection.getHeaderField("ETag"))
    } finally {
      connection.disconnect()
    }
  }

  /**
   * Sets [REQUEST_ID_HEADER] only when [requestId] is non-null, and logs the method, path and id
   * once so a phone log line can be joined to the bridge's record of the same request.
   */
  private fun stampRequestId(connection: HttpURLConnection, requestId: String?) {
    if (requestId == null) return
    connection.setRequestProperty(REQUEST_ID_HEADER, requestId)
    Log.d(TAG, "${connection.requestMethod} ${connection.url.path} requestId=$requestId")
  }

  /** Reads the whole stream as UTF-8 text, returning `null` when nothing is readable. */
  private fun readAll(stream: java.io.InputStream): String? {
    return try {
      BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { reader ->
        reader.readText()
      }
    } catch (error: Throwable) {
      null
    }
  }
}
