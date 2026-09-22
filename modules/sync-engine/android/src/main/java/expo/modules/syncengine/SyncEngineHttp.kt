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
 * Minimal bridge HTTP transport for the native engine: one `POST` with JSON body, bearer auth
 * and the same 10 s connect/read budget as the JS bridge client (`BRIDGE_REQUEST_TIMEOUT_MS`).
 * Deliberately uses `HttpURLConnection` — no new dependency on the sync path.
 *
 * Transport failures throw; the cycle runner owns mapping them onto the attempt's outcome.
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
