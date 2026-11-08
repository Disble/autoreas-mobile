package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The native `cycle_report` body (odd/tasks/mobile-report-kinds.md S2; Bridge schema
 * `SyncDiagnosticsCycleReport`): exact wire bytes, the Kotlin stage map, and the closed error
 * vocabularies, which take the class name only -- never a message. Robolectric supplies the real
 * `org.json` the body is built with.
 */
@RunWith(RobolectricTestRunner::class)
class SyncEngineCycleReportTest {

  @Test
  fun `a failed native cycle is reported inside previous_cycle under its own id`() {
    val body = buildNativeCycleReport(
      NativeCycleReport(
        cycleId = "c-1",
        triggerSource = "foreground_service",
        startedAtMs = 1_000L,
        elapsedMs = 2_500L,
        stage = "sent",
        errorName = "SocketTimeoutException",
        pendingOpsCount = 4L,
        cursor = 2287L,
      ),
    )

    assertEquals(
      """{"kind":"cycle_report","cycle_id":"c-1","degraded":null,"trigger_source":"foreground_service",""" +
        """"app_state":"background","previous_cycle":{"cycle_id":"c-1","trigger_source":"foreground_service",""" +
        """"outcome":"failed","last_stage":"http","started_at":1000,"elapsed_ms":2500,""" +
        """"error_name":"BridgeTimeoutError","native_errcode_byte":null,"error_stage":null,""" +
        """"error_cause":"timeout","error_fingerprint":null},""" +
        """"counters":{"consecutive_unclosed_cycles":0,"pending_ops_count":4,"cursor":2287},""" +
        """"recent_events":[]}""",
      body,
    )
  }

  @Test
  fun `an unknown class carries a fingerprint, an unknown stage none, and a clock step no negative time`() {
    val body = buildNativeCycleReport(
      NativeCycleReport("c-2", "background_task", 1_000L, -5L, "not_applicable", "IllegalStateException", 0L, 0L),
    )

    assertEquals(true, body.contains(""""last_stage":null"""))
    assertEquals(true, body.contains(""""elapsed_ms":0"""))
    assertEquals(true, body.contains(""""error_name":"unknown""""))
    assertEquals(true, body.contains(""""error_fingerprint":"${nativeErrorFingerprint("IllegalStateException")}""""))
    assertEquals(true, body.contains(""""trigger_source":"background_task","outcome":"failed""""))
  }

  @Test
  fun `the Kotlin state maps onto Bridge's last_stage vocabulary`() {
    val mapped = listOf("idle", "checked", "claimed", "sent", "applied", "closed", "failed", "abandoned")
      .associateWith(::nativeCycleReportStage)

    assertEquals(
      mapOf(
        "idle" to "open",
        "checked" to "attempt_started",
        "claimed" to "claim_ops",
        "sent" to "http",
        "applied" to "apply_write",
        "closed" to "closed",
        "failed" to null,
        "abandoned" to null,
      ),
      mapped,
    )
  }

  @Test
  fun `an error class maps onto the closed error_name and error_cause lists`() {
    val classified = listOf(
      "SocketTimeoutException", "ConnectException", "NoRouteToHostException", "UnknownHostException",
      "PortUnreachableException", "ReconcileHttpError", "ReconcileParseException",
      "SQLiteDatabaseLockedException", "SQLiteTableLockedException", "SQLiteFullException",
      "SQLiteDiskIOException", "SQLiteConstraintException",
    ).associateWith { name -> classifyNativeCycleError(name).let { "${it.errorName}/${it.errorCause}/${it.fingerprint}" } }

    assertEquals(
      mapOf(
        "SocketTimeoutException" to "BridgeTimeoutError/timeout/null",
        "ConnectException" to "BridgeUnreachableError/unreachable/null",
        "NoRouteToHostException" to "BridgeUnreachableError/unreachable/null",
        "UnknownHostException" to "BridgeUnreachableError/unreachable/null",
        "PortUnreachableException" to "BridgeUnreachableError/unreachable/null",
        "ReconcileHttpError" to "ReconcileHttpError/unknown/null",
        "ReconcileParseException" to "SchemaValidationError/unknown/null",
        "SQLiteDatabaseLockedException" to "LocalWriteError/lock_contention/null",
        "SQLiteTableLockedException" to "LocalWriteError/lock_contention/null",
        "SQLiteFullException" to "LocalWriteError/disk_full/null",
        "SQLiteDiskIOException" to "LocalWriteError/io_error/null",
        "SQLiteConstraintException" to "LocalWriteError/unknown/null",
      ),
      classified,
    )
    assertEquals(NativeCycleErrorClass("unknown", "unknown", null), classifyNativeCycleError(null))
    assertEquals("unknown", classifyNativeCycleError("SQLiteLooksLikeButIsNot").errorName)
  }

  @Test
  fun `the fingerprint is 32-bit FNV-1a as eight lowercase hex characters`() {
    // Published FNV-1a 32-bit test vectors.
    assertEquals("811c9dc5", nativeErrorFingerprint(""))
    assertEquals("e40c292c", nativeErrorFingerprint("a"))
    assertEquals("bf9cf968", nativeErrorFingerprint("foobar"))
  }
}
