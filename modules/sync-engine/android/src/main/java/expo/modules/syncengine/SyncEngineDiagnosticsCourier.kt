package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.io.InputStream
import java.math.BigInteger
import java.net.HttpURLConnection
import java.net.URL
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** Batch size per drain; mirrors `SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE`. */
const val SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE = 3

/** Per-request budget; mirrors `SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS`. */
const val SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS = 3_000

/** Upper bound on a persisted `Retry-After` delay; mirrors `SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS`. */
const val SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS = 3_600_000L

/**
 * Wall-clock budget for one drain pass, bounding how many requests a single attempt can START.
 *
 * The batch size alone does not bound the drain's cost: three requests that each burn their full
 * 3 s budget would cost 9 s of the attempt's own 30 s ([ENGINE_BUDGET_MS]) before the reconcile it
 * exists to accompany (`BRIDGE_REQUEST_TIMEOUT_MS`, 10 s) even begins. Two full requests fit this
 * bound; the third is never started, because a partial request buys nothing -- the bridge either
 * answers the whole body or the row stays queued for the next trigger. That caps the drain at
 * ~6 s of an attempt that has already reserved 10 s for the reconcile and must still leave room
 * for the claim, the apply and the prune.
 */
const val SYNC_DIAGNOSTICS_DRAIN_BUDGET_MS = 6_000L

/**
 * The wait applied to a `503` that declares no usable `Retry-After`.
 *
 * The bridge declares `503` as its OWN backpressure status -- its contract is "503 with
 * `Retry-After: 5`" (odd/tasks/chapter-action-diagnostics.md) -- so a `503` that arrives without
 * the header is that same declaration with the header lost or stripped in transit (a proxy in
 * front of the bridge is the usual reason), not a different verdict about our bytes. Deferring by
 * the bridge's declared wait is therefore the honest reading, and it is the difference between a
 * one-cycle stall and a hot loop against a bridge that is already asking for room.
 *
 * Deliberately scoped to `503` ALONE: the other retryable verdicts (`401`, `404`, `408`, `422`,
 * `429`, `500`, a transport failure) declare no wait at all, so inventing one there would be a
 * backoff this app made up rather than one the bridge asked for. Those stop the batch without a
 * gate, which is exactly what the trigger cadence is for.
 */
const val SYNC_DIAGNOSTICS_UNAVAILABLE_RETRY_AFTER_MS = 5_000L

/**
 * Diagnostics body `kind`s this build may POST, mirroring `SYNC_DIAGNOSTICS_ACCEPTED_KINDS`.
 *
 * Empty, and that is the registry's real state: its single JS entry is `undefined`, which
 * identifies the ABSENCE of a `kind` key -- the frozen compatibility rule for the already-deployed
 * cycle report. JSON cannot represent `undefined`, so that entry is structurally unreachable from
 * a NAMED token and is handled where it is read instead ([classifyDiagnosticsPayload] treats an
 * ABSENT `kind` as that legacy envelope, and parks a present JSON `null` as a declaration naming
 * no token this build knows). Adding `episode_action` here is the whole change that lets
 * observations flow, on both the JS and the native side.
 */
val SYNC_DIAGNOSTICS_ACCEPTED_KINDS: Set<String> = emptySet()

/**
 * Diagnostics body `kind`s this build KNOWS the bridge does not accept, mirroring
 * `SYNC_DIAGNOSTICS_UNDELIVERABLE_KINDS`: declaration, not inference. Empty is a legitimate and
 * complete state -- destruction requires a positive statement from the bridge, and "not currently
 * in the accepted registry" is never one, because that would turn an app rollback into an
 * irreversible loss of the rolled-forward build's backlog.
 */
val SYNC_DIAGNOSTICS_UNDELIVERABLE_KINDS: Set<String> = emptySet()

/** Endpoint one stored envelope is posted to; mirrors `BRIDGE_API_PATHS.syncDiagnostics`. */
const val SYNC_DIAGNOSTICS_PATH = "/api/sync/diagnostics"

/**
 * The bridge's ONE recoverable refusal code, mirroring the JS drainer's constant of the same name:
 * `kind_not_served`, whose bytes are NOT wrong -- that bridge build simply does not serve the kind,
 * so a forward roll recovers every row kept. Every other vocabulary member, and a refusal declaring
 * no `code` at all, keeps the verdict its status declares.
 *
 * DUPLICATION RISK: the JS drainer holds this same constant across a language boundary with no
 * shared artifact, and drift between the two is a disagreement about what may be DESTROYED.
 */
const val SYNC_DIAGNOSTICS_RECOVERABLE_REFUSAL_CODE = "kind_not_served"

/**
 * One diagnostics POST's observable result: the status, the declared wait, and the body's top-level
 * refusal `code` ([readDiagnosticsRefusalCode]).
 */
data class SyncDiagnosticsPostResult(
  val code: Int,
  val retryAfterMillis: Long? = null,
  val refusalCode: String? = null,
)

/** Transport one stored diagnostics envelope is posted through. */
fun interface SyncDiagnosticsTransport {
  /** Posts [body] verbatim; throws only on a transport failure, exactly like the JS client. */
  fun post(url: String, token: String, body: String, timeoutMs: Int): SyncDiagnosticsPostResult
}

/** The bridge coordinates one drain needs. */
data class SyncDiagnosticsConnection(
  val ip: String,
  val port: String,
  val token: String,
)

/**
 * Per-drain tally; mirrors `SyncDiagnosticsFlushResult` plus the counters the native drain keeps
 * beside it. Four counts are deliberately NEVER conflated, because they answer four different
 * questions and only two of them are a data loss:
 * - [discarded] -- the bridge's own verdict destroyed the body (`413` with or without a code, or a
 *   `400` that declared one, unless the refusal was the recoverable one); a loss, by contract;
 * - [undeliverable] -- this build's declaration destroyed the body; a loss, by judgement, and the
 *   counter whose visibility matters most when the registry is flipped;
 * - [unclassified] -- another build's body, parked untouched; a gap, not a loss;
 * - [reaped] -- a PARKED row the age bound retired; a loss by EXPIRY, and the one counter that must
 *   never be folded into [discarded]: that one answers "the bridge refused these bytes" while this
 *   one answers "we gave up waiting for a bridge that would have accepted them", which are opposite
 *   conclusions about the client. It is not the cap's shed count either -- a shed drops rows for
 *   CAPACITY at the door, while a reap is a decision about one row this pass read.
 */
data class SyncDiagnosticsFlushResult(
  val attempted: Int = 0,
  val delivered: Int = 0,
  val discarded: Int = 0,
  val failedRemovals: Int = 0,
  val undeliverable: Int = 0,
  val unclassified: Int = 0,
  val reaped: Int = 0,
)

/**
 * Parses a `Retry-After` header value into a delay in ms; mirrors `parseRetryAfterMs`.
 *
 * Delta-seconds (the form the bridge's contract actually sends) is parsed first and clamped at
 * [SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS] BEFORE any arithmetic that could overflow: the header is
 * remote input, and `"99999999999999999999"` must clamp rather than wrap into a negative delay
 * that would open the gate in the past. The three HTTP-date forms are defensive -- a proxy may
 * rewrite the header -- and use the full-string parse, so a value like `"12:00"` (not a date) is
 * rejected instead of being half-read as a time. Anything unparseable answers `null`, which the
 * drain reads as "stop, but persist no gate".
 */
fun parseRetryAfterMillis(rawValue: String?, now: Long): Long? {
  val raw = rawValue?.trim()
  if (raw.isNullOrEmpty()) return null

  if (DELTA_SECONDS_PATTERN.matches(raw)) {
    val milliseconds = BigInteger(raw).multiply(BigInteger.valueOf(MILLIS_PER_SECOND))
    return milliseconds.min(BigInteger.valueOf(SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS)).toLong()
  }

  // Cheap rejection of the shapes that can only be a delta or a broken header before three date
  // parses are attempted on them.
  if (!raw.contains(':')) return null
  val parsed = parseHttpDate(raw) ?: return null
  return (parsed - now).coerceIn(0L, SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS)
}

private const val MILLIS_PER_SECOND = 1_000L

private val DELTA_SECONDS_PATTERN = Regex("^\\d+$")

/** RFC 1123 (IMF-fixdate) first: it is the form `Retry-After` specifies. */
private val HTTP_DATE_PATTERNS = listOf(
  "EEE, dd MMM yyyy HH:mm:ss zzz",
  "EEEE, dd-MMM-yy HH:mm:ss zzz", // RFC 850, still emitted by some proxies
  "EEE MMM d HH:mm:ss yyyy", // asctime, whose day field may carry a double space
)

private val HTTP_WHITESPACE_PATTERN = Regex("\\s+")

/**
 * Parses one of the three HTTP-date forms in GMT, answering epoch millis or `null`. The string is
 * whitespace-normalized (asctime pads the day with two spaces) and parsed against the FULL input:
 * a partial match is not a date, it is a header this build does not understand.
 */
private fun parseHttpDate(raw: String): Long? {
  val normalized = raw.replace(HTTP_WHITESPACE_PATTERN, " ")
  for (pattern in HTTP_DATE_PATTERNS) {
    val position = ParsePosition(0)
    val parsed = SimpleDateFormat(pattern, Locale.US)
      .apply {
        timeZone = TimeZone.getTimeZone("GMT")
        isLenient = false
      }
      .parse(normalized, position)
    if (parsed != null && position.index == normalized.length) return parsed.time
  }
  return null
}

/**
 * HTTP transport for one diagnostics POST: the same header contract as [SyncEngineHttp.postJson]
 * (POST, `Content-Type: application/json`, `Authorization: Bearer <token>`, the caller's
 * connect/read budget), plus the two things that call cannot report -- the `Retry-After` response
 * header the drain's gate is built from, and the refusal `code` its ladder branches on.
 *
 * Any status code is a normal return, never an exception: a 4xx/5xx is a VERDICT the drain must
 * tally, and only a transport failure (timeout, refused connection, DNS) throws, exactly like the
 * JS bridge client. The response body is read best effort from whichever stream the status code
 * makes readable, so a bridge error body cannot stall the connection either.
 */
object HttpSyncDiagnosticsTransport : SyncDiagnosticsTransport {
  override fun post(url: String, token: String, body: String, timeoutMs: Int): SyncDiagnosticsPostResult {
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
      val retryAfter = connection.getHeaderField("Retry-After")
      // Best effort: a body this build cannot read is never a delivery failure.
      val responseBody = readBodyQuietly(
        if (code in 200..299) connection.inputStream else connection.errorStream,
      )
      return SyncDiagnosticsPostResult(
        code = code,
        retryAfterMillis = parseRetryAfterMillis(retryAfter, System.currentTimeMillis()),
        refusalCode = readDiagnosticsRefusalCode(responseBody),
      )
    } finally {
      connection.disconnect()
    }
  }

  /** Reads the response body best effort, or `null`: not reading it is never a delivery failure. */
  private fun readBodyQuietly(stream: InputStream?): String? =
    try {
      stream?.use { String(it.readBytes(), Charsets.UTF_8) }
    } catch (error: Throwable) {
      null
    }
}

/**
 * Native diagnostics drainer: gates on the user's telemetry switch, then posts stored envelopes
 * oldest-first, one bounded batch per attempt.
 *
 * The disposition ladder is the JS flush's (`sync-diagnostics-flush.helpers.ts`) with the
 * corrected verdict set:
 * - the user's switch is consulted FIRST, and a disabled switch returns the zeroed tally without
 *   reading, POSTing, removing or deferring anything, so queued rows survive the switch being off
 *   untouched;
 * - `2xx` removes the row and counts it `delivered` only when the removal is CONFIRMED, otherwise
 *   `failedRemovals` (the row is still there for the next pass);
 * - `413` with or without a code, or a `400` that DECLARED one, is the bridge's ENTIRE permanence
 *   declaration for this endpoint: it removes the row, counts it `discarded` and continues the
 *   batch, UNLESS the refusal declared `kind_not_served`, which KEEPS the row and stops the batch
 *   because those bytes are not wrong -- that bridge build simply does not serve that kind, so a
 *   forward roll recovers every row kept. A codeless `400` is NOT a verdict at all: it is a VERSION
 *   state, so the row is KEPT and the batch STOPS, and discarding on it would destroy the whole
 *   backlog on first contact with a bridge older than the refusal vocabulary. The permanence set is
 *   exactly those two statuses: `422` is NOT a body verdict here (inherited from a different
 *   endpoint's handler, and anything the contract does not declare must be retryable). A non-2xx
 *   verdict ALWAYS wins over the budget check;
 * - a body whose `kind` parks or is destroyed by declaration never reaches the wire (see
 *   [classifyDiagnosticsPayload]) and the batch continues, so one unroutable row cannot starve the
 *   deliverable envelopes behind it;
 * - a PARKED row -- an unnamed `kind`, or a codeless-`400` stop -- that outlives
 *   [SYNC_DIAGNOSTICS_PARKED_ROW_MAX_AGE_MS] is REAPED and counted as `reaped`, never as
 *   `discarded`, and the batch keeps the disposition's OWN decision: the codeless-`400` park still
 *   stops it, the unnamed kind still continues it. The bound is about liveness rather than about
 *   the bytes: an indefinite park spends every batch on rows that can never drain while the cap
 *   sheds the newest telemetry, which is the loss this bound exists to shorten;
 * - every other outcome -- `401`/`404`/`408`/`422`/`429`/`5xx`, or a transport failure -- leaves
 *   the row and STOPS the batch: the link or the bridge is down, and the rows behind it would fail
 *   identically. A usable `Retry-After` (or the bridge's declared `503` wait) is persisted as a
 *   not-before gate before stopping;
 * - the drain budget ([SYNC_DIAGNOSTICS_DRAIN_BUDGET_MS]) bounds how many requests one pass can
 *   START, shortening the last one's timeout to what is left.
 *
 * `drain` NEVER THROWS and never returns a failure: instrumentation delivery must never be the
 * reason a sync cycle fails, so an unreadable store, an unparseable body or a dead bridge is
 * reported through the tally and the attempt's own outcome stays untouched.
 *
 * [acceptedKinds] and [undeliverableKinds] are the registry and the destruction declaration, both
 * injectable so a test can pin all three classification branches and so the flip that ships the
 * first accepted kind is a one-line change at the call site.
 */
class SyncEngineDiagnosticsCourier(
  private val telemetryFile: File?,
  private val transport: SyncDiagnosticsTransport = HttpSyncDiagnosticsTransport,
  private val now: () -> Long = System::currentTimeMillis,
  private val acceptedKinds: Set<String> = SYNC_DIAGNOSTICS_ACCEPTED_KINDS,
  private val undeliverableKinds: Set<String> = SYNC_DIAGNOSTICS_UNDELIVERABLE_KINDS,
) {
  /** Drains at most one batch, never throwing and never affecting the attempt's outcome. */
  fun drain(
    isSyncTelemetryEnabled: Boolean,
    connection: SyncDiagnosticsConnection,
  ): SyncDiagnosticsFlushResult {
    // The switch first, and the zeroed tally rather than an empty pass: while the user's switch is
    // off nothing may be read or written, which is what keeps queued rows pending instead of
    // quietly consuming them.
    if (!isSyncTelemetryEnabled) return SyncDiagnosticsFlushResult()
    val file = telemetryFile ?: return SyncDiagnosticsFlushResult()
    // An attempt without a usable connection must not spend a request, and the config's own
    // completeness rule is the same one the reconcile uses.
    if (connection.ip.isBlank() || connection.port.isBlank() || connection.token.isBlank()) {
      return SyncDiagnosticsFlushResult()
    }

    var attempted = 0
    var delivered = 0
    var discarded = 0
    var failedRemovals = 0
    var undeliverable = 0
    var unclassified = 0
    var reaped = 0
    val budgetEndsAt = now() + SYNC_DIAGNOSTICS_DRAIN_BUDGET_MS

    try {
      SyncEngineDiagnosticsOutbox(file).use { outbox ->
        val candidates = outbox.readCandidates(SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE, now())
        for (candidate in candidates) {
          // The budget bounds REQUESTS, not rows: checking it here (rather than after the POST)
          // is what guarantees the third request of an exhausted pass is never started.
          val remainingMs = budgetEndsAt - now()
          if (remainingMs <= 0L) break

          when (classifyDiagnosticsPayload(candidate.payload, acceptedKinds, undeliverableKinds)) {
            DiagnosticsPayloadKind.UNDELIVERABLE -> {
              outbox.remove(candidate.cycleId)
              undeliverable += 1
              continue
            }

            DiagnosticsPayloadKind.UNCLASSIFIED -> {
              // A park answers for itself and no request is spent on it. Past the age bound it is
              // REAPED instead of counted -- apart from both destructions -- and the batch still
              // CONTINUES, which is this park's OWN decision rather than the bound's.
              val rowAgeMs = now() - candidate.createdAt
              if (shouldReapParkedDiagnosticsRow(DiagnosticsPayloadKind.UNCLASSIFIED, null, rowAgeMs)) {
                outbox.remove(candidate.cycleId)
                reaped += 1
              } else {
                unclassified += 1
              }
              continue
            }

            DiagnosticsPayloadKind.ROUTABLE -> Unit
          }

          attempted += 1
          val result = try {
            transport.post(
              url = "http://${connection.ip}:${connection.port}$SYNC_DIAGNOSTICS_PATH",
              token = connection.token,
              body = candidate.payload,
              timeoutMs = minOf(SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS.toLong(), remainingMs).toInt(),
            )
          } catch (error: Throwable) {
            break // transport failure: the link or the bridge is down, so the row stays queued
          }

          if (result.code in 200..299) {
            if (outbox.remove(candidate.cycleId)) delivered += 1 else failedRemovals += 1
            continue
          }

          // Checked BEFORE the permanence set: the recoverable refusal keeps the row and stops.
          val recoverableRefusal = result.refusalCode == SYNC_DIAGNOSTICS_RECOVERABLE_REFUSAL_CODE
          val permanent = !recoverableRefusal &&
            isPermanentDiagnosticsRejection(result.code, result.refusalCode)
          if (permanent) {
            // The bridge's ENTIRE permanence declaration for this endpoint -- a `413` with or
            // without a code, or a `400` that DECLARED one: it will answer these for the same bytes
            // forever, so keeping the row would only strand it. A codeless `400` is NOT one of
            // these: it is a version state, so it never reaches `discarded` here. The batch
            // continues -- the next envelope may be perfectly deliverable.
            outbox.remove(candidate.cycleId)
            discarded += 1
            continue
          }

          // Kept, so this row was parked (a `400` that declared no code) or is pending. Past the
          // age bound the PARK is REAPED -- apart from both destructions -- and the park's OWN
          // decision still STOPS the batch, because the bridge is still the wrong version and the
          // next row would be refused identically. No gate is written: the reap replaced the park
          // before its deferral would have run.
          val rowAgeMs = now() - candidate.createdAt
          if (shouldReapParkedDiagnosticsRow(DiagnosticsPayloadKind.ROUTABLE, result, rowAgeMs)) {
            outbox.remove(candidate.cycleId)
            reaped += 1
            break
          }

          val retryAfterMillis = result.retryAfterMillis
            ?: if (result.code == HTTP_SERVICE_UNAVAILABLE) {
              SYNC_DIAGNOSTICS_UNAVAILABLE_RETRY_AFTER_MS
            } else {
              null
            }
          if (retryAfterMillis != null) outbox.deferUntil(now() + retryAfterMillis)
          break
        }
      }
    } catch (error: Throwable) {
      // Swallowed by contract (Decision 5): instrumentation delivery must never fail the cycle.
    }

    return SyncDiagnosticsFlushResult(
      attempted = attempted,
      delivered = delivered,
      discarded = discarded,
      failedRemovals = failedRemovals,
      undeliverable = undeliverable,
      unclassified = unclassified,
      reaped = reaped,
    )
  }

  companion object {
    /**
     * Builds the production courier for an app database, or a no-op one when it has no file. The
     * only variable part is [appDb]'s path: the telemetry database is its SIBLING, because that is
     * where expo-sqlite puts both files (`filesDir/SQLite/`) and therefore where the JS outbox
     * writer put its own -- the courier adds no second convention. [transport] is injectable so a
     * test can observe the request this seam resolves the target for.
     */
    fun forAppDatabase(
      appDb: SQLiteDatabase,
      transport: SyncDiagnosticsTransport = HttpSyncDiagnosticsTransport,
    ): SyncEngineDiagnosticsCourier =
      SyncEngineDiagnosticsCourier(
        telemetryFile = appDb.path?.let { resolveTelemetryDatabaseFile(File(it)) },
        transport = transport,
      )
  }
}

private const val HTTP_SERVICE_UNAVAILABLE = 503
