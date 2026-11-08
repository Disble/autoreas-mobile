package expo.modules.foregroundsyncticker

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The native sync diary (odd/tasks/mobile-report-kinds.md T2, S3, S5, S6), driven only through its
 * public API against a real telemetry database whose outbox table is provisioned the way the JS
 * store provisions it. Every assertion reads the outbox rows the drains would deliver.
 */
@RunWith(RobolectricTestRunner::class)
class SyncDiaryTest {

  @get:Rule
  val folder = TemporaryFolder()

  @Test
  fun `a missing telemetry file is never created and nothing is recorded`() {
    val file = File(folder.root, "autoreas-telemetry.db")
    val diary = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds())

    assertFalse(diary.recordAttempt("manual", "closed", 10L, HOUR_1))
    assertFalse(diary.recordProcessDeath("sync", "low_memory", HOUR_1))
    assertEquals(
      SyncDiaryEnqueueResult.UNAVAILABLE,
      diary.recordTransition("main", "network", "started", null, HOUR_1, HOUR_1),
    )
    assertEquals(SyncDiaryEnqueueResult.UNAVAILABLE, diary.enqueueReport("r-1", "{}", HOUR_1))
    assertFalse(file.exists())
  }

  @Test
  fun `attempts are counted per pair and reported once their hour closes`() {
    val file = provisionedTelemetryFile()
    val diary = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds())

    assertTrue(diary.recordAttempt("manual", "closed", 900L, HOUR_1 + 1_000L))
    assertTrue(diary.recordAttempt("manual", "closed", 300L, HOUR_1 + 2_000L))
    assertTrue(diary.recordAttempt("foreground_service", "failed", 5_000_000L, HOUR_1 + 3_000L))
    // The hour is still open: nothing is reported, and no timer will report it (S6).
    assertEquals(emptyList<Pair<String, String>>(), outboxRows(file))

    assertTrue(diary.recordAttempt("app_active", "closed", 50L, HOUR_2 + 10L))

    assertEquals(
      listOf(
        "id-1:$HOUR_1" to
          """{"kind":"hourly_summary","observation_id":"id-1:$HOUR_1","hour_start_ms":$HOUR_1,""" +
          """"counts":[{"trigger_source":"foreground_service","outcome":"failed","count":1,"max_duration_ms":3600000},""" +
          """{"trigger_source":"manual","outcome":"closed","count":2,"max_duration_ms":900}],""" +
          """"dropped_count":0}""",
      ),
      outboxRows(file),
    )

    // The closed hour's rows are gone: once delivered, the next close reports only hour 2.
    clearOutbox(file)
    assertTrue(diary.recordAttempt("manual", "closed", 1L, HOUR_3))
    assertEquals(listOf("id-1:$HOUR_2"), outboxRows(file).map { it.first })
    assertTrue(outboxRows(file).single().second.contains(""""counts":[{"trigger_source":"app_active","outcome":"closed","count":1,"max_duration_ms":50}]"""))
  }

  @Test
  fun `an off-list trigger source or outcome is rejected and never counted`() {
    val file = provisionedTelemetryFile()
    val diary = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds())

    assertFalse(diary.recordAttempt("local_mutation_write", "closed", 1L, HOUR_1))
    assertFalse(diary.recordAttempt("manual", "abandoned", 1L, HOUR_1))
    SYNC_DIARY_TRIGGER_SOURCES.forEach { source -> assertTrue(diary.recordAttempt(source, "closed", 1L, HOUR_1)) }
    SYNC_DIARY_OUTCOMES.forEach { outcome -> assertTrue(diary.recordAttempt("manual", outcome, 1L, HOUR_1)) }
    assertEquals(8, SYNC_DIARY_TRIGGER_SOURCES.size)
    assertEquals(7, SYNC_DIARY_OUTCOMES.size)

    diary.recordAttempt("manual", "closed", 1L, HOUR_2)

    val summary = outboxRows(file).single().second
    assertFalse(summary.contains("local_mutation_write"))
    assertFalse(summary.contains("abandoned"))
    // 8 sources x closed, plus manual x the other 6 outcomes: each pair once.
    assertEquals(14, Regex("\"trigger_source\"").findAll(summary).count())
  }

  @Test
  fun `process deaths are counted in the hour they are read and reported with the summary`() {
    val file = provisionedTelemetryFile()
    val diary = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds())

    assertTrue(diary.recordProcessDeath("sync", "low_memory", HOUR_1))
    assertTrue(diary.recordProcessDeath("sync", "low_memory", HOUR_1 + 5L))
    assertTrue(diary.recordProcessDeath("main", "crash", HOUR_1 + 6L))
    assertFalse(diary.recordProcessDeath("headless", "crash", HOUR_1))
    assertFalse(diary.recordProcessDeath("sync", "Low Memory", HOUR_1))
    assertFalse(diary.recordProcessDeath("sync", "x".repeat(41), HOUR_1))

    assertTrue(diary.recordProcessDeath("main", "crash", HOUR_2))

    assertEquals(
      listOf(
        "id-1:$HOUR_1" to
          """{"kind":"hourly_summary","observation_id":"id-1:$HOUR_1","hour_start_ms":$HOUR_1,""" +
          """"counts":[],"dropped_count":0,"process_deaths":[""" +
          """{"process_name":"sync","reason":"low_memory","count":2},""" +
          """{"process_name":"main","reason":"crash","count":1}]}""",
      ),
      outboxRows(file),
    )

    // Once delivered, the next close reports only the hour 2 death.
    clearOutbox(file)
    assertTrue(diary.recordProcessDeath("main", "crash", HOUR_3))
    assertEquals(listOf("id-1:$HOUR_2"), outboxRows(file).map { it.first })
    assertTrue(outboxRows(file).single().second.endsWith(""""process_deaths":[{"process_name":"main","reason":"crash","count":1}]}"""))
  }

  @Test
  fun `a real state change becomes one runtime transition row`() {
    val file = provisionedTelemetryFile()
    val diary = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds())

    assertEquals(
      SyncDiaryEnqueueResult.INSERTED,
      diary.recordTransition("sync", "process", "died", "low_memory", 1_234L, HOUR_1),
    )
    assertEquals(
      SyncDiaryEnqueueResult.INSERTED,
      diary.recordTransition("main", "network", "started", null, HOUR_1 + 1L, HOUR_1 + 2L),
    )

    assertEquals(
      listOf(
        // id-1 is the install id, minted first; each event takes its own fresh id.
        "id-2" to
          """{"kind":"runtime_transition","observation_id":"id-2","observed_at_ms":1234,""" +
          """"process_name":"sync","subject":"process","transition":"died","reason":"low_memory",""" +
          """"app_version":"$APP_VERSION"}""",
        "id-3" to
          """{"kind":"runtime_transition","observation_id":"id-3","observed_at_ms":${HOUR_1 + 1L},""" +
          """"process_name":"main","subject":"network","transition":"started","app_version":"$APP_VERSION"}""",
      ),
      outboxRows(file),
    )
  }

  @Test
  fun `only the fourteen agreed pairs are accepted`() {
    val file = provisionedTelemetryFile()
    val diary = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds())
    val accepted = listOf(
      "service" to "started", "service" to "stopped", "service" to "refused",
      "tick_alarm" to "armed", "tick_alarm" to "cancelled",
      "floor" to "armed", "floor" to "cancelled", "floor" to "skipped", "floor" to "started",
      "process" to "started", "process" to "died", "boot" to "started",
      "network" to "started", "network" to "stopped",
    )

    accepted.forEach { (subject, transition) ->
      assertEquals(
        "$subject/$transition",
        SyncDiaryEnqueueResult.INSERTED,
        diary.recordTransition("sync", subject, transition, null, HOUR_1, HOUR_1),
      )
    }
    listOf(
      Triple("sync", "tick_alarm", "started"),
      Triple("sync", "boot", "stopped"),
      Triple("main", "process", "died"),
      Triple("sync", "screen", "started"),
      Triple("headless", "service", "started"),
    ).forEach { (process, subject, transition) ->
      assertEquals(
        "$process/$subject/$transition",
        SyncDiaryEnqueueResult.REJECTED,
        diary.recordTransition(process, subject, transition, null, HOUR_1, HOUR_1),
      )
    }
    assertEquals(
      SyncDiaryEnqueueResult.REJECTED,
      diary.recordTransition("sync", "service", "started", "Not-A-Reason", HOUR_1, HOUR_1),
    )
    assertEquals(
      SyncDiaryEnqueueResult.REJECTED,
      diary.recordTransition("sync", "service", "started", null, -1L, HOUR_1),
    )
    assertEquals(14, outboxRows(file).size)
  }

  @Test
  fun `new kinds stop at sixty outbox rows and the skipped report is counted in the next summary`() {
    val file = provisionedTelemetryFile()
    val diary = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds())
    repeat(60) { index -> seedEpisodeAction(file, "episode-$index") }

    assertEquals(
      SyncDiaryEnqueueResult.DROPPED,
      diary.recordTransition("main", "network", "stopped", null, HOUR_1, HOUR_1),
    )
    assertEquals(60, outboxRows(file).size)
    assertFalse(outboxRows(file).any { it.second.contains("runtime_transition") })

    // An episode action still fits: the reserve keeps 40 rows for it.
    seedEpisodeAction(file, "episode-60")
    assertEquals(61, outboxRows(file).size)

    // The drains deliver the backlog; the next hour reports the skipped row.
    clearOutbox(file)
    diary.recordAttempt("manual", "closed", 1L, HOUR_2)
    assertEquals(
      listOf(
        "id-1:$HOUR_1" to
          """{"kind":"hourly_summary","observation_id":"id-1:$HOUR_1","hour_start_ms":$HOUR_1,""" +
          """"counts":[],"dropped_count":1}""",
      ),
      outboxRows(file),
    )

    // The dropped count was reset once reported: once delivered, hour 1 is never reported again,
    // and the hour 2 summary carries 0.
    clearOutbox(file)
    diary.recordAttempt("manual", "closed", 1L, HOUR_3)
    assertEquals(listOf("id-1:$HOUR_2"), outboxRows(file).map { it.first })
    assertTrue(outboxRows(file).single().second.endsWith(""""dropped_count":0}"""))
  }

  @Test
  fun `at most fifty new reports a day, counted again the next UTC day`() {
    val file = provisionedTelemetryFile()
    val diary = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds())

    repeat(50) { index ->
      assertEquals(
        SyncDiaryEnqueueResult.INSERTED,
        diary.enqueueReport("report-$index", """{"kind":"cycle_report"}""", DAY_1 + index),
      )
    }
    assertEquals(
      SyncDiaryEnqueueResult.DROPPED,
      diary.enqueueReport("report-50", """{"kind":"cycle_report"}""", DAY_1 + 100L),
    )
    assertEquals(50, outboxRows(file).size)

    clearOutbox(file)
    assertEquals(
      SyncDiaryEnqueueResult.INSERTED,
      diary.enqueueReport("report-51", """{"kind":"cycle_report"}""", DAY_2),
    )
    // The new day's first record also closed the day-1 hour, whose skipped report it names.
    diary.recordAttempt("manual", "closed", 1L, DAY_2 + 1L)
    val summary = outboxRows(file).single { it.first == "id-1:$DAY_1" }.second
    assertTrue(summary.endsWith(""""dropped_count":1}"""))
  }

  @Test
  fun `the first write of an observation id wins and costs no daily slot`() {
    val file = provisionedTelemetryFile()
    val diary = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds())

    assertEquals(SyncDiaryEnqueueResult.INSERTED, diary.enqueueReport("same", """{"n":1}""", DAY_1))
    assertEquals(SyncDiaryEnqueueResult.DUPLICATE, diary.enqueueReport("same", """{"n":2}""", DAY_1))
    assertEquals(listOf("same" to """{"n":1}"""), outboxRows(file))

    repeat(49) { index ->
      assertEquals(
        SyncDiaryEnqueueResult.INSERTED,
        diary.enqueueReport("other-$index", "{}", DAY_1 + 1L),
      )
    }
    assertEquals(SyncDiaryEnqueueResult.DROPPED, diary.enqueueReport("over", "{}", DAY_1 + 2L))
  }

  @Test
  fun `the install id is minted once and shared by every writer`() {
    val file = provisionedTelemetryFile()
    val mainProcess = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds("main"))
    val syncProcess = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds("sync"))

    mainProcess.recordAttempt("manual", "closed", 1L, HOUR_1)
    syncProcess.recordAttempt("foreground_service", "closed", 1L, HOUR_2)
    mainProcess.recordAttempt("manual", "closed", 1L, HOUR_3)

    assertEquals(listOf("main-1:$HOUR_1", "main-1:$HOUR_2"), outboxRows(file).map { it.first })
  }

  @Test
  fun `an app version off the wire pattern is sent as unknown`() {
    assertEquals("2.7.1", sanitizeSyncDiaryAppVersion("2.7.1"))
    assertEquals("unknown", sanitizeSyncDiaryAppVersion(null))
    assertEquals("unknown", sanitizeSyncDiaryAppVersion("2.7.1 (debug)"))
    assertEquals("unknown", sanitizeSyncDiaryAppVersion("1".repeat(33)))
  }

  @Test
  fun `the diary file is the telemetry sibling of the app database`() {
    val filesDir = folder.newFolder("files")

    assertEquals(
      File(File(filesDir, "SQLite"), "autoreas-telemetry.db"),
      resolveSyncDiaryTelemetryFile(filesDir),
    )
  }

  @Test
  fun `the app diary writes next to the app database and names the installed version`() {
    val context: Context = ApplicationProvider.getApplicationContext()
    val file = resolveSyncDiaryTelemetryFile(context.filesDir)
    file.parentFile?.mkdirs()
    provisionOutbox(file)
    @Suppress("DEPRECATION")
    val installed = context.packageManager.getPackageInfo(context.packageName, 0).versionName

    syncDiaryFor(context).recordTransition("main", "boot", "started", null, HOUR_1, HOUR_1)
    // Robolectric runs as the main process, so the call waits in the inbox until `:sync` moves it;
    // the body still names the build that made it, not the one that moved it.
    assertEquals(1, SyncDiary(file, null, isSyncProcess = true).drainInbox())

    val body = outboxRows(file).single().second
    assertTrue(body, body.endsWith(""""app_version":"${sanitizeSyncDiaryAppVersion(installed)}"}"""))
  }

  @Test
  fun `a telemetry file without the outbox table records nothing and never throws`() {
    val file = File(folder.root, "autoreas-telemetry.db")
    SQLiteDatabase.openOrCreateDatabase(file, null).close()
    val diary = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds())

    assertEquals(
      SyncDiaryEnqueueResult.UNAVAILABLE,
      diary.recordTransition("main", "network", "started", null, HOUR_1, HOUR_1),
    )
    assertTrue(diary.recordAttempt("manual", "closed", 1L, HOUR_1))
    // Closing hour 1 cannot reach the missing outbox, so the whole record rolls back.
    assertFalse(diary.recordAttempt("manual", "closed", 1L, HOUR_2))
  }

  @Test
  fun `a limited report stops at its hourly quota per key, shared by every writer`() {
    val file = provisionedTelemetryFile()
    val diary = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds())
    val other = SyncDiary(file, APP_VERSION, isSyncProcess = true, newId = sequentialIds("other"))

    assertEquals(SyncDiaryEnqueueResult.INSERTED, diary.enqueueLimitedReport("a", 2, "r-1", "{}", HOUR_1))
    assertEquals(SyncDiaryEnqueueResult.DUPLICATE, diary.enqueueLimitedReport("a", 2, "r-1", "{}", HOUR_1))
    assertEquals(SyncDiaryEnqueueResult.INSERTED, other.enqueueLimitedReport("a", 2, "r-2", "{}", HOUR_1 + 1L))
    assertEquals(SyncDiaryEnqueueResult.LIMITED, diary.enqueueLimitedReport("a", 2, "r-3", "{}", HOUR_1 + 2L))
    assertEquals(SyncDiaryEnqueueResult.INSERTED, diary.enqueueLimitedReport("b", 2, "r-4", "{}", HOUR_1 + 3L))
    assertEquals(SyncDiaryEnqueueResult.INSERTED, diary.enqueueLimitedReport("a", 2, "r-5", "{}", HOUR_2))

    assertEquals(listOf("r-1", "r-2", "r-4", "r-5"), outboxRows(file).map { it.first })
  }

  private fun provisionedTelemetryFile(): File =
    File(folder.root, "autoreas-telemetry.db").also(::provisionOutbox)

  private fun provisionOutbox(file: File) {
    SQLiteDatabase.openOrCreateDatabase(file, null).use { database ->
      database.execSQL(
        "CREATE TABLE IF NOT EXISTS sync_diagnostics_outbox (" +
          "cycle_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL)",
      )
    }
  }

  private fun seedEpisodeAction(file: File, cycleId: String) {
    SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READWRITE).use { database ->
      database.execSQL(
        "INSERT INTO sync_diagnostics_outbox (cycle_id, payload, created_at) VALUES (?, ?, 0)",
        arrayOf<Any>(cycleId, """{"kind":"episode_action"}"""),
      )
    }
  }

  private fun clearOutbox(file: File) {
    SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READWRITE).use { database ->
      database.execSQL("DELETE FROM sync_diagnostics_outbox")
    }
  }

  private fun outboxRows(file: File): List<Pair<String, String>> =
    SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
      database.rawQuery(
        "SELECT cycle_id, payload FROM sync_diagnostics_outbox ORDER BY created_at, rowid",
        null,
      ).use { cursor ->
        buildList { while (cursor.moveToNext()) add(cursor.getString(0) to cursor.getString(1)) }
      }
    }

  private fun sequentialIds(prefix: String = "id"): () -> String {
    var next = 0
    return { "$prefix-${++next}" }
  }

  private companion object {
    const val APP_VERSION = "2.7.1"
    const val HOUR_MS = 3_600_000L
    const val DAY_1 = 20_000L * 86_400_000L
    const val DAY_2 = DAY_1 + 86_400_000L
    const val HOUR_1 = DAY_1 + 5 * HOUR_MS
    const val HOUR_2 = HOUR_1 + HOUR_MS
    const val HOUR_3 = HOUR_2 + HOUR_MS
  }
}
