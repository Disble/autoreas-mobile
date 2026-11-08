package expo.modules.syncengine

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import expo.modules.foregroundsyncticker.SyncDiary
import java.io.File
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Native attempt counting and failed-cycle reports (odd/tasks/mobile-report-kinds.md S2, S3):
 * every native end maps onto the hourly summary's vocabulary, only FAILED cycles are reported, at
 * most three per `error_name` an hour, and nothing at all while the user's switch is off. Every
 * assertion reads the outbox the drains deliver.
 */
@RunWith(RobolectricTestRunner::class)
class SyncEngineAttemptDiaryTest {

  private val context: Context = ApplicationProvider.getApplicationContext()
  private lateinit var outbox: SyncDiaryTestOutbox
  private var now = HOUR_1
  private var appState: NativeDiaryAppState? = NativeDiaryAppState(true, 4L, 2287L)
  private val stateReads = mutableListOf<Boolean>()

  @Before
  fun setUp() {
    outbox = SyncDiaryTestOutbox(context)
  }

  @After
  fun tearDown() {
    outbox.close()
  }

  private fun newDiary(): SyncEngineAttemptDiary =
    SyncEngineAttemptDiary(SyncDiary(outbox.file, "2.7.1") { "id" }, { includeCounters ->
      stateReads += includeCounters
      appState
    }) { now }

  private fun settled(outcome: String, stage: String = "sent", errorName: String? = null) =
    NativeAttemptEnd.Settled(CycleOutcome(outcome, stage, 0, 0, errorName))

  private fun fgs(end: NativeAttemptEnd, cycleId: String? = "c-1", startMs: Long = now - 700L) =
    NativeAttemptRecord(SyncForegroundService.TRIGGER_SOURCE, cycleId, startMs, end)

  /** The hour's counts, closed by a record in the next hour, as `source/outcome=count`. */
  private fun closedHourCounts(): List<String> {
    now = HOUR_1 + HOUR_MS
    newDiary().record(NativeAttemptRecord(SYNC_FLOOR_TRIGGER_SOURCE, null, now, NativeAttemptEnd.SkippedOwnedByTicker))
    val summary = outbox.rows().map { it.second }.single { it.getString("kind") == "hourly_summary" }
    val counts = summary.getJSONArray("counts")
    return (0 until counts.length()).map { index ->
      val item = counts.getJSONObject(index)
      "${item.getString("trigger_source")}/${item.getString("outcome")}=${item.getLong("count")}"
    }
  }

  private fun reports(): List<Pair<String, JSONObject>> =
    outbox.rows().filter { it.second.getString("kind") == "cycle_report" }

  @Test
  fun `every native end is counted under the diary's vocabulary, once`() {
    val diary = newDiary()
    listOf(
      settled("closed"), settled("failed", errorName = "ConnectException"), settled("abandoned"),
      settled("not_applicable", "idle", "BridgePresenceRefused"), settled("not_applicable", "idle", "SchemaNotReady"),
      NativeAttemptEnd.Crashed, NativeAttemptEnd.Unsettled,
    ).forEachIndexed { index, end -> diary.record(fgs(end, cycleId = "c-$index")) }
    diary.record(NativeAttemptRecord(SYNC_FLOOR_TRIGGER_SOURCE, null, now, NativeAttemptEnd.SkippedOwnedByTicker))
    // Not counted (L5): no config or a lease held elsewhere, and a trigger the diary does not know.
    diary.record(fgs(settled("not_applicable", "checked", null)))
    diary.record(NativeAttemptRecord("manual", "c-9", now, settled("closed")))

    assertEquals(
      listOf(
        "background_task/skipped_owned_by_ticker=1",
        "foreground_service/closed=1",
        "foreground_service/crashed=1",
        "foreground_service/failed=1",
        "foreground_service/presence_refused=1",
        "foreground_service/schema_not_ready=1",
        "foreground_service/unsettled=2",
      ),
      closedHourCounts(),
    )
  }

  @Test
  fun `a failed cycle is reported with its counters, under its own id`() {
    newDiary().record(fgs(settled("failed", "applied", "SQLiteDatabaseLockedException"), startMs = now - 1_500L))

    val (cycleId, body) = reports().single()
    assertEquals("c-1", cycleId)
    assertEquals("c-1", body.getString("cycle_id"))
    val previous = body.getJSONObject("previous_cycle")
    assertEquals("c-1", previous.getString("cycle_id"))
    assertEquals("apply_write", previous.getString("last_stage"))
    assertEquals("LocalWriteError", previous.getString("error_name"))
    assertEquals("lock_contention", previous.getString("error_cause"))
    assertEquals(now - 1_500L, previous.getLong("started_at"))
    assertEquals(1_500L, previous.getLong("elapsed_ms"))
    assertEquals(
      """{"consecutive_unclosed_cycles":0,"pending_ops_count":4,"cursor":2287}""",
      body.getJSONObject("counters").toString(),
    )
    assertEquals("only a report reads the counters", listOf(true), stateReads)
  }

  @Test
  fun `abandoned and not applicable cycles are counted but never reported`() {
    val diary = newDiary()
    diary.record(fgs(settled("abandoned", "sent", "LeaseLost")))
    diary.record(fgs(settled("not_applicable", "idle", "BridgePresenceRefused")))
    diary.record(fgs(settled("closed", "closed")))

    assertEquals(emptyList<Pair<String, JSONObject>>(), reports())
    assertEquals(listOf(false, false, false), stateReads)
  }

  @Test
  fun `at most three reports per error name an hour`() {
    val diary = newDiary()
    (1..4).forEach { index -> diary.record(fgs(settled("failed", errorName = "SocketTimeoutException"), "t-$index")) }
    diary.record(fgs(settled("failed", errorName = "ReconcileHttpError"), "h-1"))
    now = HOUR_1 + HOUR_MS
    diary.record(fgs(settled("failed", errorName = "SocketTimeoutException"), "t-5"))

    assertEquals(listOf("t-1", "t-2", "t-3", "h-1", "t-5"), reports().map { it.first })
  }

  @Test
  fun `nothing is recorded while the switch is off or the app database is unreadable`() {
    appState = NativeDiaryAppState(false, 0L, 0L)
    newDiary().record(fgs(settled("failed", errorName = "ConnectException")))
    appState = null
    newDiary().record(fgs(settled("failed", errorName = "ConnectException"), "c-2"))
    newDiary().record(fgs(NativeAttemptEnd.Crashed))

    assertEquals(emptyList<Pair<String, JSONObject>>(), outbox.rows())
  }

  @Test
  fun `the app database answers the switch and the counters read-only`() {
    SyncEngineTestDatabase(appDatabaseIsFile = true).use { store ->
      val file = store.appDatabaseFile
      assertEquals("no config row reads as enabled", NativeDiaryAppState(true, 0L, 0L), readNativeDiaryAppState(file, true))

      store.appDatabase.execSQL(
        "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id, is_sync_telemetry_enabled) " +
          "VALUES (1, 'd', '10.0.0.2', '3000', 't', 2287, 1)",
      )
      store.addOperation(1L, "pending")
      store.addOperation(2L, "pending")
      store.addOperation(3L, "synced")
      assertEquals(NativeDiaryAppState(true, 2L, 2287L), readNativeDiaryAppState(file, true))
      assertEquals(NativeDiaryAppState(true, 0L, 0L), readNativeDiaryAppState(file, false))

      store.appDatabase.execSQL("UPDATE bridge_config SET is_sync_telemetry_enabled = 0")
      assertEquals(NativeDiaryAppState(false, 0L, 0L), readNativeDiaryAppState(file, true))
    }
    assertNull(readNativeDiaryAppState(File(context.filesDir, "missing.db"), true))
  }

  @Test
  fun `the production recorder reads the app database beside the telemetry one`() {
    val appFile = resolveAppDatabaseFile(context)
    SQLiteDatabase.openOrCreateDatabase(appFile, null).use { database ->
      database.execSQL(
        "CREATE TABLE bridge_config (id INTEGER PRIMARY KEY, device_id TEXT, ip TEXT, port TEXT, " +
          "token TEXT, last_changelog_id INTEGER, is_sync_telemetry_enabled INTEGER)",
      )
      database.execSQL("INSERT INTO bridge_config (id, last_changelog_id) VALUES (1, 7)")
    }
    try {
      recordNativeSyncAttempt(context, fgs(settled("failed", "checked", "ConnectException"), "p-1"))

      val (_, body) = reports().single()
      assertEquals("attempt_started", body.getJSONObject("previous_cycle").getString("last_stage"))
      assertEquals("pending_ops_count is 0 when operation_log is unreadable", 0, body.getJSONObject("counters").getInt("pending_ops_count"))
      assertEquals(7, body.getJSONObject("counters").getInt("cursor"))
    } finally {
      SQLiteDatabase.deleteDatabase(appFile)
    }
  }

  private companion object {
    const val HOUR_MS = 3_600_000L
    const val HOUR_1 = 20_000L * 86_400_000L + 5 * HOUR_MS
  }
}
