package expo.modules.foregroundsyncticker

import android.app.ActivityManager
import android.app.Application
import android.app.ApplicationExitInfo
import android.app.ForegroundServiceStartNotAllowedException
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowActivityManager.ApplicationExitInfoBuilder
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * [SyncDiaryRuntime] (odd/tasks/mobile-report-kinds.md S4): the process a change is reported from,
 * the once-per-process start, and what a start reads -- Android's exit history (a `sync` death per
 * event, a `main` death as a count) and a reboot -- each reported once across both processes.
 * Every assertion reads the outbox the drains deliver.
 */
@RunWith(RobolectricTestRunner::class)
class SyncDiaryRuntimeTest {

  private val context: Context = ApplicationProvider.getApplicationContext()
  private lateinit var outbox: SyncDiaryTestOutbox

  @Before
  fun setUp() {
    outbox = SyncDiaryTestOutbox(context, processName = "com.example.app:sync")
  }

  @After
  fun tearDown() {
    outbox.close()
  }

  @Test
  fun `the process name is sync only inside the sync process`() {
    assertEquals("sync", SyncDiaryRuntime.processName(context))
    SyncDiaryRuntime.processNameReader = { "com.example.app" }
    assertEquals("main", SyncDiaryRuntime.processName(context))
    SyncDiaryRuntime.processNameReader = { null }
    assertEquals("main", SyncDiaryRuntime.processName(context))

    assertEquals("sync", syncDiaryProcessNameOf("com.example.app", "com.example.app:sync"))
    assertEquals("main", syncDiaryProcessNameOf("com.example.app", "com.example.app"))
    assertEquals(null, syncDiaryProcessNameOf("com.example.app", "com.example.app:other"))
  }

  @Test
  fun `a transition is stamped with the process it happened in and the runtime clock`() {
    SyncDiaryRuntime.clock = { NOW }

    SyncDiaryRuntime.recordTransition(context, "service", "started")

    val body = outbox.payloads().single()
    assertEquals("runtime_transition", body.getString("kind"))
    assertEquals("sync", body.getString("process_name"))
    assertEquals(NOW, body.getLong("observed_at_ms"))
    assertEquals(listOf("sync/service/started"), outbox.transitions())
  }

  @Test
  fun `an error becomes a reason from its class name alone`() {
    assertEquals(
      "foreground_service_start_not_allowed",
      syncDiaryReasonFromError(ForegroundServiceStartNotAllowedException("secret detail")),
    )
    assertEquals("illegal_state", syncDiaryReasonFromError(IllegalStateException("x")))
    assertEquals("security", syncDiaryReasonFromError(SecurityException()))
    assertEquals("unknown", syncDiaryReasonFromError(object : RuntimeException() {}))
    assertEquals("an over-long name is cut, never sent off-pattern", 40, syncDiaryReasonFromError(VeryLongNamedFailureThatKeepsGoingForeverAndEverException()).length)
  }

  @Test
  fun `every Android exit reason maps onto its own recorded reason`() {
    val mapped = mapOf(
      ApplicationExitInfo.REASON_ANR to "anr",
      ApplicationExitInfo.REASON_CRASH to "crash",
      ApplicationExitInfo.REASON_CRASH_NATIVE to "crash_native",
      ApplicationExitInfo.REASON_DEPENDENCY_DIED to "dependency_died",
      ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE to "excessive_resource_usage",
      ApplicationExitInfo.REASON_EXIT_SELF to "exit_self",
      ApplicationExitInfo.REASON_FREEZER to "freezer",
      ApplicationExitInfo.REASON_INITIALIZATION_FAILURE to "initialization_failure",
      ApplicationExitInfo.REASON_LOW_MEMORY to "low_memory",
      ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE to "package_state_change",
      ApplicationExitInfo.REASON_PACKAGE_UPDATED to "package_updated",
      ApplicationExitInfo.REASON_PERMISSION_CHANGE to "permission_change",
      ApplicationExitInfo.REASON_SIGNALED to "signaled",
      ApplicationExitInfo.REASON_UNKNOWN to "unknown",
      ApplicationExitInfo.REASON_USER_REQUESTED to "user_requested",
      ApplicationExitInfo.REASON_USER_STOPPED to "user_stopped",
      -1 to "other",
    )

    assertEquals(mapped, mapped.keys.associateWith(::syncDiaryExitReason))
    assertEquals("every mapped reason fits the wire pattern", true, mapped.values.all(::isSyncDiaryReason))
  }

  @Test
  fun `the default readers ask Android`() {
    SyncDiaryRuntime.resetForTest()
    val packageName = context.packageName
    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    listOf(
      Triple(packageName, ApplicationExitInfo.REASON_LOW_MEMORY, 100L),
      Triple("$packageName:sync", ApplicationExitInfo.REASON_SIGNALED, 200L),
      Triple("$packageName:other", ApplicationExitInfo.REASON_CRASH, 300L),
    ).forEach { (process, reason, at) ->
      shadowOf(activityManager).addApplicationExitInfo(
        ApplicationExitInfoBuilder.newBuilder().setProcessName(process).setReason(reason).setTimestamp(at).build(),
      )
    }

    assertEquals(Application.getProcessName(), SyncDiaryRuntime.processNameReader(context))
    assertEquals("main", SyncDiaryRuntime.processName(context))
    assertEquals(
      setOf(SyncDiaryProcessExit("main", "low_memory", 100L), SyncDiaryProcessExit("sync", "signaled", 200L)),
      SyncDiaryRuntime.exitReader(context).toSet(),
    )

    // A platform without the activity service has no history to read: nothing, never a throw.
    shadowOf(context as Application).setSystemService(Context.ACTIVITY_SERVICE, null)
    assertEquals(emptyList<SyncDiaryProcessExit>(), SyncDiaryRuntime.exitReader(context))
  }

  @Test
  fun `exits off the vocabulary are skipped and a bad boot is rejected`() {
    SyncDiaryRuntime.clock = { HOUR_1 }
    SyncDiaryRuntime.noteProcessStart(context)
    newProcess(processName = "com.example.app:sync")
    SyncDiaryRuntime.exitReader = {
      listOf(exit("sync", "Not A Reason", 300L), exit("sync", "crash", -1L), exit("sync", "crash", 400L))
    }
    SyncDiaryRuntime.noteProcessStart(context)

    assertEquals(listOf("sync/process/started", "sync/process/started", "sync/process/died/crash"), outbox.transitions())

    val diary = syncDiaryFor(context)
    assertEquals(SyncDiaryEnqueueResult.REJECTED, diary.recordBoot("headless", HOUR_1, HOUR_1))
    assertEquals(SyncDiaryEnqueueResult.REJECTED, diary.recordBoot("sync", -1L, HOUR_1))
    assertEquals(3, outbox.transitions().size)
  }

  @Test
  fun `a process start is reported once per process however often it is noted`() {
    SyncDiaryRuntime.noteProcessStart(context)
    SyncDiaryRuntime.noteProcessStart(context)

    assertEquals(listOf("sync/process/started"), outbox.transitions())
  }

  @Test
  fun `deaths that predate the first read are never reported, later ones once each`() {
    SyncDiaryRuntime.clock = { HOUR_1 }
    SyncDiaryRuntime.exitReader = { listOf(exit("sync", "low_memory", 100L), exit("main", "crash", 200L)) }
    SyncDiaryRuntime.noteProcessStart(context)
    assertEquals(listOf("sync/process/started"), outbox.transitions())

    // The next process start: the history now also holds one new death of each process.
    newProcess(processName = "com.example.app")
    SyncDiaryRuntime.exitReader = {
      listOf(
        exit("sync", "low_memory", 100L),
        exit("main", "crash", 200L),
        exit("sync", "signaled", 300L),
        exit("main", "anr", 400L),
      )
    }
    SyncDiaryRuntime.noteProcessStart(context)

    val died = outbox.payloads().single { it.optString("transition") == "died" }
    assertEquals("sync", died.getString("process_name"))
    assertEquals("signaled", died.getString("reason"))
    assertEquals("Android's exit timestamp", 300L, died.getLong("observed_at_ms"))
    assertEquals(listOf("sync/process/started", "main/process/started", "sync/process/died/signaled"), outbox.transitions())

    // The other process reads the same history: nothing is reported twice.
    newProcess(processName = "com.example.app:sync")
    SyncDiaryRuntime.noteProcessStart(context)
    assertEquals(1, outbox.transitions().count { it.contains("died") })

    // The main death is a count in the hour it was read, reported with that hour's summary.
    SyncDiaryRuntime.clock = { HOUR_1 + HOUR_MS }
    SyncDiaryRuntime.recordTransition(context, "network", "started")
    val summary = outbox.payloads().single { it.getString("kind") == "hourly_summary" }
    assertEquals(
      """[{"process_name":"main","reason":"anr","count":1}]""",
      summary.getJSONArray("process_deaths").toString(),
    )
  }

  @Test
  fun `a reboot is reported once, at the computed boot time, and never on the first sighting`() {
    SyncDiaryRuntime.clock = { HOUR_1 }
    SyncDiaryRuntime.elapsedRealtime = { 10_000L }
    SyncDiaryRuntime.noteProcessStart(context)
    assertEquals(listOf("sync/process/started"), outbox.transitions())

    // The same boot, seen again later with a little clock drift: nothing new.
    newProcess(processName = "com.example.app")
    SyncDiaryRuntime.clock = { HOUR_1 + 600_000L }
    SyncDiaryRuntime.elapsedRealtime = { 10_000L + 600_000L - SYNC_DIARY_BOOT_TOLERANCE_MS }
    SyncDiaryRuntime.noteProcessStart(context)
    assertEquals(listOf("sync/process/started", "main/process/started"), outbox.transitions())

    // A new boot: elapsedRealtime started over.
    newProcess(processName = "com.example.app:sync")
    SyncDiaryRuntime.clock = { HOUR_1 + 900_000L }
    SyncDiaryRuntime.elapsedRealtime = { 5_000L }
    SyncDiaryRuntime.noteProcessStart(context)
    val boot = outbox.payloads().single { it.optString("subject") == "boot" }
    assertEquals("started", boot.getString("transition"))
    assertEquals(HOUR_1 + 900_000L - 5_000L, boot.getLong("observed_at_ms"))

    // The main process starting after the same reboot does not report it again.
    newProcess(processName = "com.example.app")
    SyncDiaryRuntime.clock = { HOUR_1 + 960_000L }
    SyncDiaryRuntime.elapsedRealtime = { 65_000L }
    SyncDiaryRuntime.noteProcessStart(context)
    assertEquals(1, outbox.transitions().count { it.contains("boot") })
  }

  @Test
  fun `a diary failure never escapes into the caller`() {
    outbox.file.delete()
    SyncDiaryRuntime.exitReader = { throw IllegalStateException("history unavailable") }

    SyncDiaryRuntime.noteProcessStart(context)
    SyncDiaryRuntime.recordTransition(context, "service", "started")
    SyncDiaryRuntime.executor = java.util.concurrent.Executor { throw IllegalStateException("shut down") }
    SyncDiaryRuntime.recordTransition(context, "service", "stopped")
  }

  /** Simulates the next process start: a fresh once-per-process flag under [processName]. */
  private fun newProcess(processName: String) {
    val clock = SyncDiaryRuntime.clock
    val elapsed = SyncDiaryRuntime.elapsedRealtime
    val exits = SyncDiaryRuntime.exitReader
    SyncDiaryRuntime.resetForTest()
    SyncDiaryRuntime.executor = java.util.concurrent.Executor { it.run() }
    SyncDiaryRuntime.processNameReader = { processName }
    SyncDiaryRuntime.clock = clock
    SyncDiaryRuntime.elapsedRealtime = elapsed
    SyncDiaryRuntime.exitReader = exits
  }

  private fun exit(process: String, reason: String, at: Long) = SyncDiaryProcessExit(process, reason, at)

  /** A class whose snake-cased name runs past the 40-character reason limit. */
  private class VeryLongNamedFailureThatKeepsGoingForeverAndEverException : RuntimeException()

  private companion object {
    const val HOUR_MS = 3_600_000L
    const val HOUR_1 = 20_000L * 86_400_000L + 5 * HOUR_MS
    const val NOW = HOUR_1 + 1_234L
  }
}
