package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.util.Log

private const val TAG = "SyncEngineBridgePresence"

/**
 * Timeout budget for the presence probe, bounding BOTH the connect and the read phase (same
 * shape [SyncEngineHttp.postJson] already uses for its own budget). Mirrors
 * `ATTEMPT_PROBE_DEADLINE_MS` in `src/features/sync/attempt-policy.constants.ts` (1500 ms): that
 * constant is what keeps a skipped JS tick well under its 2 s no-op acceptance bound, and the
 * native gate (ODD native-foreground-sync-service T2 / T14 native half) exists for the exact
 * same reason on the native path -- see the "why" section at the top of
 * `docs/mobile-background-sync-investigation-log.md`: the bridge is absent for roughly 6 hours
 * every night, and every one of those ticks must cost under 2 s and touch no local storage, or
 * the foreground service would burn its whole budget probing a bridge that never answers.
 */
const val PRESENCE_PROBE_TIMEOUT_MS = 1_500

/**
 * Outcome of one presence probe: whether the bridge answered at all, and -- only when it did
 * not -- a short, loggable reason. [reason] is diagnostic only; nothing downstream branches on
 * its exact value.
 */
data class PresenceProbeResult(
  val isPresent: Boolean,
  val reason: String?,
)

/**
 * Native mirror of the JS presence gate: `probeBridgePresence()` in
 * `src/features/sync/notifee-foreground-service-adapter/notifee-foreground-service-adapter.helpers.ts`
 * (~lines 94-116), which asks the bridge's side-effect-free `GET /api/status`
 * (`bridgeClient.getStatus`, `src/infrastructure/api/bridge-client/bridge-client.helpers.ts`)
 * with the `ATTEMPT_PROBE_DEADLINE_MS` budget. [SyncEngineRunner] calls this BEFORE arming the
 * watchdog or touching the cycle lease when its own `requirePresence` gate is on, so a probe
 * refusal never claims operations, never takes the lease, and -- by never calling
 * [SyncEngineJournal.append] -- never writes to the journal either.
 *
 * Contract, replicated exactly from the JS probe:
 * - a `bridge_config` row missing `ip`, `port`, or `token` is absence. `deviceId` is
 *   deliberately NOT required here even though [hasCompleteBridgeConnection] requires it for a
 *   real sync attempt -- the JS probe checks only `config?.ip`, `config.port`, `config.token`
 *   (see the source above), and this probe exists to answer the exact same question the JS one
 *   does, not the engine's own "can I run a full cycle" question;
 * - ANY completed HTTP exchange is presence, whatever its status code (including 401/403/404):
 *   the JS probe never inspects `response.ok`, it only asks whether `bridgeClient.getStatus`
 *   resolved at all. Only a transport failure -- a timeout, a refused connection, a DNS failure,
 *   anything [SyncEngineHttp.get] throws -- is absence, exactly like a thrown
 *   `BridgeTimeoutError`/`BridgeUnreachableError` on the JS side;
 * - never throws: every failure path (missing config, unreadable config, transport failure)
 *   degrades to `isPresent = false` with a reason, so a gated caller can always resolve.
 */
object SyncEngineBridgePresence {

  /** Runs one presence probe against the app database's current `bridge_config` row. */
  fun probe(appDb: SQLiteDatabase): PresenceProbeResult {
    return probe(readBridgeConfig(appDb))
  }

  /**
   * Pure probe seam (config -> HTTP), added by the ODD native-foreground-sync-service testing
   * pass so this class's contract can be exercised with a fake HTTP server and a plain
   * [BridgeConfigRow] fixture, without opening a real SQLite connection. [probe] above is now a
   * thin adapter that reads the row and delegates here; behavior is byte-identical to before the
   * split — every branch and log line moved verbatim, nothing was added or reordered.
   */
  fun probe(config: BridgeConfigRow?): PresenceProbeResult {
    if (config == null) {
      return PresenceProbeResult(isPresent = false, reason = "no bridge_config row")
    }

    if (config.ip.isNullOrBlank() || config.port.isNullOrBlank() || config.token.isNullOrBlank()) {
      return PresenceProbeResult(isPresent = false, reason = "bridge_config incomplete")
    }

    // Non-null by the check above; local aliases keep the smart-cast (same idiom as the
    // analogous `hasCompleteBridgeConnection` check in SyncEngineCycle.runCycle).
    val ip = config.ip ?: ""
    val port = config.port ?: ""
    val token = config.token ?: ""

    return try {
      SyncEngineHttp.get(
        url = "http://$ip:$port/api/status",
        token = token,
        timeoutMs = PRESENCE_PROBE_TIMEOUT_MS,
      )
      PresenceProbeResult(isPresent = true, reason = null)
    } catch (error: Throwable) {
      Log.w(TAG, "presence probe transport failure", error)
      PresenceProbeResult(isPresent = false, reason = error.javaClass.simpleName)
    }
  }
}
