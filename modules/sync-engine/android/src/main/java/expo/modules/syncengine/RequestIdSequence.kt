package expo.modules.syncengine

import java.util.concurrent.atomic.AtomicInteger

/**
 * Header that correlates one bridge request with the attempt that made it. The bridge validates
 * its value against `^[A-Za-z0-9._-]{1,48}:[0-9]{1,9}$` and mints its own id when the header is
 * absent or invalid, so a request without one keeps working unchanged.
 */
const val REQUEST_ID_HEADER = "X-Autoreas-Request-Id"

/**
 * The request ids of ONE native sync attempt: `<cycleId>:<n>`, where [cycleId] is the attempt's
 * existing UUID and n starts at 1 and grows by one per bridge request, in send order. One
 * instance is created per attempt by [SyncEngineRunner.runOnce] and shared by every request that
 * attempt makes (the presence probe, the diagnostics drain, the fetch-first GET, the reconciles
 * and the season-rating POSTs). [next] is thread-safe, so no two requests ever share a number.
 */
class RequestIdSequence(private val cycleId: String) {
  private val counter = AtomicInteger(0)

  /** Answers the id for the next request of this attempt. */
  fun next(): String = "$cycleId:${counter.incrementAndGet()}"
}
