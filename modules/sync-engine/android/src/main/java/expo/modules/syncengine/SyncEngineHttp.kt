package expo.modules.syncengine

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/** One completed bridge HTTP exchange: status code plus the body actually received. */
data class SyncEngineHttpResponse(
  val code: Int,
  val body: String?,
)

/**
 * Minimal bridge HTTP transport for the native engine: [postJson] issues the reconcile `POST`
 * with a JSON body and the same 10 s connect/read budget as the JS bridge client
 * (`BRIDGE_REQUEST_TIMEOUT_MS`); [get] issues the presence probe's bodyless `GET` with its own,
 * shorter budget ([PRESENCE_PROBE_TIMEOUT_MS]). Deliberately uses `HttpURLConnection` — no new
 * dependency on the sync path.
 *
 * Transport failures throw; callers ([SyncEngineCycle], [SyncEngineBridgePresence]) own mapping
 * them onto their own outcome.
 */
object SyncEngineHttp {

  /**
   * Issues one POST and reads the response body from whichever stream the status code makes
   * readable (2xx from the input stream, errors from the error stream), so a bridge error body
   * survives for the failure reason.
   */
  fun postJson(
    url: String,
    token: String,
    body: String,
    timeoutMs: Int,
  ): SyncEngineHttpResponse {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.requestMethod = "POST"
    connection.connectTimeout = timeoutMs
    connection.readTimeout = timeoutMs
    connection.doOutput = true
    connection.setRequestProperty("Content-Type", "application/json")
    connection.setRequestProperty("Authorization", "Bearer $token")

    try {
      connection.outputStream.use { output ->
        output.write(body.toByteArray(Charsets.UTF_8))
        output.flush()
      }
      val code = connection.responseCode
      val stream = if (code in 200..299) connection.inputStream else connection.errorStream
      return SyncEngineHttpResponse(code, stream?.let { readAll(it) })
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
   * thrown transport failure (timeout, refused connection, DNS failure) is absence.
   */
  fun get(
    url: String,
    token: String,
    timeoutMs: Int,
  ): SyncEngineHttpResponse {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.requestMethod = "GET"
    connection.connectTimeout = timeoutMs
    connection.readTimeout = timeoutMs
    connection.setRequestProperty("Authorization", "Bearer $token")

    return try {
      val code = connection.responseCode
      val stream = if (code in 200..299) connection.inputStream else connection.errorStream
      SyncEngineHttpResponse(code, stream?.let { readAll(it) })
    } finally {
      connection.disconnect()
    }
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
