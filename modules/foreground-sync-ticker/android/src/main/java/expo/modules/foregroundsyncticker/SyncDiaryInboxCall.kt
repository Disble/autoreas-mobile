package expo.modules.foregroundsyncticker

import org.json.JSONArray
import org.json.JSONObject

/**
 * One diary call the main process queues in [SyncDiaryInbox] for the `:sync` process to make, one
 * subclass per public [SyncDiary] call, stored as its [kind] and [args] JSON. A call that names a
 * build ([Transition], [Boot], [Exits]) carries the main process's own version, which an update may
 * replace before `:sync` replays it.
 */
internal sealed class SyncDiaryInboxCall(val kind: String) {

  /** The call's arguments as stored in the inbox. */
  abstract fun args(): JSONObject

  /** [SyncDiary.enqueueReport]. */
  data class Report(val observationId: String, val payloadJson: String) : SyncDiaryInboxCall(KIND_REPORT) {
    override fun args(): JSONObject = JSONObject().put("observation_id", observationId).put("payload", payloadJson)
  }

  /** [SyncDiary.recordAttempt]. */
  data class Attempt(val triggerSource: String, val outcome: String, val durationMs: Long) :
    SyncDiaryInboxCall(KIND_ATTEMPT) {
    override fun args(): JSONObject =
      JSONObject().put("trigger_source", triggerSource).put("outcome", outcome).put("duration_ms", durationMs)
  }

  /** [SyncDiary.recordProcessDeath]. */
  data class Death(val processName: String, val reason: String) : SyncDiaryInboxCall(KIND_DEATH) {
    override fun args(): JSONObject = JSONObject().put("process_name", processName).put("reason", reason)
  }

  /** [SyncDiary.recordTransition], with the observation id minted when it was queued. */
  data class Transition(
    val processName: String,
    val subject: String,
    val transition: String,
    val reason: String?,
    val observedAtMs: Long,
    val observationId: String,
    val appVersion: String,
  ) : SyncDiaryInboxCall(KIND_TRANSITION) {
    override fun args(): JSONObject = JSONObject()
      .put("process_name", processName)
      .put("subject", subject)
      .put("transition", transition)
      .put("reason", reason)
      .put("observed_at_ms", observedAtMs)
      .put("observation_id", observationId)
      .put("app_version", appVersion)
  }

  /** [SyncDiary.enqueueLimitedReport]. */
  data class LimitedReport(
    val limitKey: String,
    val limitPerHour: Int,
    val observationId: String,
    val payloadJson: String,
  ) : SyncDiaryInboxCall(KIND_LIMITED_REPORT) {
    override fun args(): JSONObject = JSONObject()
      .put("limit_key", limitKey)
      .put("limit_per_hour", limitPerHour)
      .put("observation_id", observationId)
      .put("payload", payloadJson)
  }

  /** [SyncDiary.recordBoot]. */
  data class Boot(val processName: String, val bootTimeMs: Long, val appVersion: String) : SyncDiaryInboxCall(KIND_BOOT) {
    override fun args(): JSONObject =
      JSONObject().put("process_name", processName).put("boot_time_ms", bootTimeMs).put("app_version", appVersion)
  }

  /** [SyncDiary.recordProcessExits]. */
  data class Exits(val exits: List<SyncDiaryProcessExit>, val appVersion: String) : SyncDiaryInboxCall(KIND_EXITS) {
    override fun args(): JSONObject {
      val list = JSONArray()
      exits.forEach { exit ->
        list.put(
          JSONObject()
            .put("process_name", exit.processName)
            .put("reason", exit.reason)
            .put("timestamp_ms", exit.timestampMs),
        )
      }
      return JSONObject().put("exits", list).put("app_version", appVersion)
    }
  }

  companion object {
    private const val KIND_REPORT = "report"
    private const val KIND_ATTEMPT = "attempt"
    private const val KIND_DEATH = "death"
    private const val KIND_TRANSITION = "transition"
    private const val KIND_LIMITED_REPORT = "limited_report"
    private const val KIND_BOOT = "boot"
    private const val KIND_EXITS = "exits"

    /** The call stored as [kind] and [argsJson]; throws when it cannot be read. */
    fun decode(kind: String, argsJson: String): SyncDiaryInboxCall {
      val args = JSONObject(argsJson)
      return when (kind) {
        KIND_REPORT -> Report(args.getString("observation_id"), args.getString("payload"))
        KIND_ATTEMPT -> Attempt(args.getString("trigger_source"), args.getString("outcome"), args.getLong("duration_ms"))
        KIND_DEATH -> Death(args.getString("process_name"), args.getString("reason"))
        KIND_TRANSITION -> Transition(
          processName = args.getString("process_name"),
          subject = args.getString("subject"),
          transition = args.getString("transition"),
          reason = if (args.isNull("reason")) null else args.getString("reason"),
          observedAtMs = args.getLong("observed_at_ms"),
          observationId = args.getString("observation_id"),
          appVersion = args.getString("app_version"),
        )
        KIND_LIMITED_REPORT -> LimitedReport(
          limitKey = args.getString("limit_key"),
          limitPerHour = args.getInt("limit_per_hour"),
          observationId = args.getString("observation_id"),
          payloadJson = args.getString("payload"),
        )
        KIND_BOOT -> Boot(args.getString("process_name"), args.getLong("boot_time_ms"), args.getString("app_version"))
        KIND_EXITS -> {
          val list = args.getJSONArray("exits")
          val exits = (0 until list.length()).map { index ->
            val exit = list.getJSONObject(index)
            SyncDiaryProcessExit(exit.getString("process_name"), exit.getString("reason"), exit.getLong("timestamp_ms"))
          }
          Exits(exits, args.getString("app_version"))
        }
        else -> throw IllegalArgumentException("unknown inbox call $kind")
      }
    }
  }
}
