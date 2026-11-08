package expo.modules.foregroundsyncticker

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The main process never opens `autoreas-telemetry.db` natively (odd/tasks/mobile-report-kinds.md,
 * verifier blocker B2): JS holds an expo-sqlite connection to that file in the main process, and a
 * second SQLite library closing its own connection there drops the process's POSIX locks. Every
 * main-process diary call goes to the inbox file beside it instead, and only `:sync` moves the
 * inbox into the outbox.
 */
@RunWith(RobolectricTestRunner::class)
class SyncDiaryInboxTest {

  private val context: Context = ApplicationProvider.getApplicationContext()
  private lateinit var outbox: SyncDiaryTestOutbox

  @Before
  fun setUp() {
    outbox = SyncDiaryTestOutbox(context, processName = "com.example.app")
  }

  @After
  fun tearDown() {
    outbox.close()
  }

  @Test
  fun `a main-process record never touches the telemetry database`() {
    val before = outbox.file.readBytes()
    val diary = syncDiaryFor(context)

    diary.recordAttempt("manual", "closed", 10L, HOUR_1)
    diary.recordProcessDeath("main", "low_memory", HOUR_1)
    diary.recordTransition("main", "network", "started", null, HOUR_1, HOUR_1)
    diary.enqueueReport("r-1", "{}", HOUR_1)
    diary.enqueueLimitedReport("cycle_report:x", 3, "r-2", "{}", HOUR_1)
    diary.recordBoot("main", HOUR_1 - 5_000L, HOUR_1)
    diary.recordProcessExits(listOf(SyncDiaryProcessExit("sync", "crash", HOUR_1 - 1L)), HOUR_1)
    SyncDiaryRuntime.recordTransition(context, "tick_alarm", "armed")
    SyncDiaryRuntime.noteProcessStart(context)

    assertArrayEquals("the telemetry file's bytes are untouched", before, outbox.file.readBytes())
    assertEquals(
      "no journal or WAL file was opened beside it",
      listOf(outbox.file.name),
      outbox.file.parentFile!!.list()!!.filter { it.startsWith(outbox.file.name) },
    )
  }

  @Test
  fun `a sync record moves the inbox in order at each call time`() {
    val main = mainDiary()
    assertTrue(main.recordAttempt("manual", "closed", 40L, HOUR_1 + MINUTE))
    assertEquals(
      SyncDiaryEnqueueResult.QUEUED,
      main.recordTransition("main", "network", "stopped", null, HOUR_1 + 2 * MINUTE, HOUR_1 + 2 * MINUTE),
    )
    assertEquals("nothing reaches the outbox from main", emptyList<Row>(), rows())

    syncDiary().recordAttempt("foreground_service", "closed", 10L, HOUR_2)

    assertEquals(
      listOf(
        Row(
          "m-1",
          """{"kind":"runtime_transition","observation_id":"m-1","observed_at_ms":${HOUR_1 + 2 * MINUTE},""" +
            """"process_name":"main","subject":"network","transition":"stopped","app_version":"$APP_VERSION"}""",
          HOUR_1 + 2 * MINUTE,
        ),
        Row(
          "s-1:$HOUR_1",
          """{"kind":"hourly_summary","observation_id":"s-1:$HOUR_1","hour_start_ms":$HOUR_1,""" +
            """"counts":[{"trigger_source":"manual","outcome":"closed","count":1,"max_duration_ms":40}],""" +
            """"dropped_count":0}""",
          HOUR_2,
        ),
      ),
      rows(),
    )
    assertEquals("a moved call is gone from the inbox", 0, syncDiary().drainInbox())
  }

  @Test
  fun `a moved report spends the same hourly quota a sync report does`() {
    val main = mainDiary()
    repeat(4) { index ->
      assertEquals(
        SyncDiaryEnqueueResult.QUEUED,
        main.enqueueLimitedReport("cycle_report:x", 3, "r-$index", """{"kind":"cycle_report"}""", HOUR_1),
      )
    }

    assertEquals(4, syncDiary().drainInbox())

    assertEquals(listOf("r-0", "r-1", "r-2"), rows().map { it.cycleId })
  }

  @Test
  fun `a full inbox counts what it turns away in that hour's dropped count`() {
    val main = mainDiary(maxRows = 2)
    assertTrue(main.recordAttempt("manual", "closed", 1L, HOUR_1))
    assertTrue(main.recordAttempt("manual", "closed", 1L, HOUR_1))
    assertFalse(main.recordAttempt("manual", "closed", 1L, HOUR_1))
    assertEquals(SyncDiaryEnqueueResult.DROPPED, main.enqueueReport("r-1", "{}", HOUR_1))

    syncDiary().recordProcessDeath("sync", "low_memory", HOUR_2)

    val summary = rows().single().payload
    assertTrue(summary, summary.contains(""""count":2"""))
    assertTrue(summary, summary.endsWith(""""dropped_count":2}"""))
  }

  @Test
  fun `a refusal is a change again once the sync process reports the service started`() {
    val main = mainDiary()
    val refuse = { main.recordTransition("main", "service", "refused", "security", HOUR_1, HOUR_1) }

    assertEquals(SyncDiaryEnqueueResult.QUEUED, refuse())
    assertEquals(SyncDiaryEnqueueResult.UNCHANGED, refuse())
    assertEquals(
      SyncDiaryEnqueueResult.INSERTED,
      syncDiary().recordTransition("sync", "service", "started", null, HOUR_1, HOUR_1),
    )
    assertEquals(SyncDiaryEnqueueResult.QUEUED, refuse())
    assertEquals(
      SyncDiaryEnqueueResult.UNCHANGED,
      syncDiary().recordTransition("sync", "service", "refused", null, HOUR_1, HOUR_1),
    )

    assertEquals(
      listOf("main/service/refused/security", "sync/service/started", "main/service/refused/security"),
      outbox.transitions(),
    )
  }

  @Test
  fun `an unreadable inbox call is counted as dropped and never blocks the drain`() {
    mainDiary().recordAttempt("manual", "closed", 1L, HOUR_1)
    SQLiteDatabase.openDatabase(outbox.inboxFile.path, null, SQLiteDatabase.OPEN_READWRITE).use { database ->
      database.execSQL("INSERT INTO sync_diary_inbox (kind, now_ms, args) VALUES ('attempt', $HOUR_1, 'not json')")
      database.execSQL("INSERT INTO sync_diary_inbox (kind, now_ms, args) VALUES ('unknown', $HOUR_1, '{}')")
    }

    assertEquals(3, syncDiary().drainInbox())
    syncDiary().recordProcessDeath("sync", "low_memory", HOUR_2)

    val summary = rows().single().payload
    assertTrue(summary, summary.contains(""""count":1"""))
    assertTrue(summary, summary.endsWith(""""dropped_count":2}"""))
  }

  @Test
  fun `without a telemetry file the main process queues nothing and creates no inbox`() {
    outbox.close()

    assertEquals(SyncDiaryEnqueueResult.UNAVAILABLE, mainDiary().enqueueReport("r-1", "{}", HOUR_1))
    assertFalse(mainDiary().recordAttempt("manual", "closed", 1L, HOUR_1))
    assertEquals(0, mainDiary().recordProcessExits(emptyList(), HOUR_1))

    assertFalse(outbox.inboxFile.exists())
    assertEquals(0, syncDiary().drainInbox())
  }

  private fun mainDiary(maxRows: Int = SYNC_DIARY_INBOX_MAX_ROWS) =
    SyncDiary(outbox.file, APP_VERSION, isSyncProcess = false, inboxMaxRows = maxRows, newId = ids("m"))

  private fun syncDiary() = SyncDiary(outbox.file, null, isSyncProcess = true, newId = ids("s"))

  private fun ids(prefix: String): () -> String {
    var next = 0
    return { "$prefix-${++next}" }
  }

  /** The outbox rows as stored, without moving the inbox first. */
  private fun rows(): List<Row> =
    SQLiteDatabase.openDatabase(outbox.file.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
      database.rawQuery("SELECT cycle_id, payload, created_at FROM sync_diagnostics_outbox ORDER BY created_at, rowid", null)
        .use { cursor -> buildList { while (cursor.moveToNext()) add(Row(cursor.getString(0), cursor.getString(1), cursor.getLong(2))) } }
    }

  private data class Row(val cycleId: String, val payload: String, val createdAt: Long)

  private companion object {
    const val APP_VERSION = "2.7.1"
    const val MINUTE = 60_000L
    const val HOUR_MS = 3_600_000L
    const val HOUR_1 = 20_000L * 86_400_000L + 5 * HOUR_MS
    const val HOUR_2 = HOUR_1 + HOUR_MS
  }
}
