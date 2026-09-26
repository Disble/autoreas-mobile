package expo.modules.syncengine

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.atomic.AtomicInteger

/** The success fixture: a closed cycle that synced three operations and read five backlog rows. */
private val OUTCOME_CLOSED = CycleOutcome("closed", "closed", 3, 5, null)

/** The failure fixture: a non-terminal outcome whose error class must reach the status row. */
private val OUTCOME_FAILED = CycleOutcome("failed", "sending", 0, 0, "SocketTimeoutException")

/** One recorded call to the worker's status-projection seam. */
private data class StatusWrite(val triggerSource: String, val outcome: CycleOutcome)

/**
 * Robolectric tests for [SyncFloorWorker] (ODD native-background-sync-cutover M2): the native
 * `WorkManager` floor that runs one native attempt when the ticker does NOT own the background.
 *
 * Every test drives the worker's own public seam -- `doWork()` -- through
 * [TestListenableWorkerBuilder], with the runner and the status projection replaced by recording
 * fakes (the same seam shape [SyncForegroundServiceTest] uses for [SyncForegroundService]): no
 * test here reaches [SyncEngineRunner]'s real SQLite-backed path or the wire. The one exception
 * is [a completed attempt persists the background_task trigger source], which deliberately uses
 * the REAL [SyncEngineRuntimeStatus] projection against a seeded `sync_runtime_status` table,
 * because "honest `background_task` status" is exactly the claim that a fake could not prove.
 *
 * The ownership gate is injected rather than armed through the ticker: arming it (`startSyncTicking`)
 * is `internal` to `foreground-sync-ticker` and therefore not reachable from this module. The real
 * check is covered where it lives -- [expo.modules.foregroundsyncticker.TickAlarmSchedulerTest] --
 * and this file covers what the worker does with its answer.
 */
@RunWith(RobolectricTestRunner::class)
class SyncFloorWorkerTest {

  private lateinit var context: Context

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
  }

  /**
   * Fake [SyncAttemptRunner] recording the invocation's arguments and running [settle] so a test
   * can script "settles once", "settles twice" or "never settles" without any thread or timing
   * assumption. [failure] makes the runner itself throw before settling.
   */
  private class RecordingRunner(
    private val failure: Throwable? = null,
    private val settle: ((CycleOutcome) -> Unit) -> Unit = { },
  ) : SyncAttemptRunner {
    val invocationCount = AtomicInteger(0)

    @Volatile
    var lastTriggerSource: String? = null

    @Volatile
    var lastRequirePresence: Boolean? = null

    override fun invoke(
      context: Context,
      triggerSource: String,
      cycleId: String,
      startMs: Long,
      requirePresence: Boolean,
      onResult: (CycleOutcome) -> Unit,
    ) {
      invocationCount.incrementAndGet()
      lastTriggerSource = triggerSource
      lastRequirePresence = requirePresence
      failure?.let { throw it }
      settle(onResult)
    }
  }

  /** Builds a worker with the given attempt runner and an optional status-projection recorder. */
  private fun newWorker(
    runner: SyncAttemptRunner,
    writes: MutableList<StatusWrite> = mutableListOf(),
  ): Pair<SyncFloorWorker, MutableList<StatusWrite>> {
    val worker = TestListenableWorkerBuilder<SyncFloorWorker>(context).build()
    worker.attemptRunner = runner
    worker.runtimeStatusWriter = { _, _, _, outcome, triggerSource ->
      writes += StatusWrite(triggerSource, outcome)
    }
    return worker to writes
  }

  @Test
  fun `the floor runs one gated native attempt and projects it as a background_task outcome`() = runBlocking {
    val runner = RecordingRunner { it(OUTCOME_CLOSED) }
    val (worker, writes) = newWorker(runner)

    val result = worker.doWork()

    assertEquals(ListenableWorker.Result.success(), result)
    assertEquals(1, runner.invocationCount.get())
    assertEquals(SYNC_FLOOR_TRIGGER_SOURCE, runner.lastTriggerSource)
    assertEquals(
      "the floor has no JS attempt policy in front of it, so it must probe presence itself",
      true,
      runner.lastRequirePresence,
    )
    assertEquals(listOf(StatusWrite(SYNC_FLOOR_TRIGGER_SOURCE, OUTCOME_CLOSED)), writes)
  }

  @Test
  fun `the floor skips the attempt entirely while the ticker owns the background`() = runBlocking {
    val runner = RecordingRunner { it(OUTCOME_CLOSED) }
    val (worker, writes) = newWorker(runner)
    worker.ownsBackgroundCheck = { true }

    val result = worker.doWork()

    assertEquals(
      "a skipped tick is a completed tick, never a failed one: the period owns the next attempt",
      ListenableWorker.Result.success(),
      result,
    )
    assertEquals("no competing attempt may start while the ticker owns the background", 0, runner.invocationCount.get())
    assertTrue("a skipped tick must not touch sync_runtime_status", writes.isEmpty())
  }

  @Test
  fun `a duplicated runner settlement is projected exactly once`() = runBlocking {
    val runner = RecordingRunner { onResult ->
      onResult(OUTCOME_CLOSED)
      onResult(OUTCOME_FAILED)
    }
    val (worker, writes) = newWorker(runner)

    val result = worker.doWork()

    assertEquals(ListenableWorker.Result.success(), result)
    assertEquals("the first settlement is the attempt's outcome", listOf(StatusWrite(SYNC_FLOOR_TRIGGER_SOURCE, OUTCOME_CLOSED)), writes)
  }

  @Test
  fun `an attempt that never settles returns retry and projects nothing`() = runBlocking {
    val runner = RecordingRunner()
    val (worker, writes) = newWorker(runner)
    worker.attemptTimeoutMsForTest = 20L

    val result = worker.doWork()

    assertEquals(
      "an unseen outcome must not be reported as success, and must not kill the periodic floor",
      ListenableWorker.Result.retry(),
      result,
    )
    assertTrue("no outcome was observed, so nothing may be projected", writes.isEmpty())
  }

  @Test
  fun `an attempt runner that throws returns retry and projects nothing`() = runBlocking {
    val runner = RecordingRunner(failure = IllegalStateException("runner exploded"))
    val (worker, writes) = newWorker(runner)

    val result = worker.doWork()

    assertEquals(ListenableWorker.Result.retry(), result)
    assertTrue(writes.isEmpty())
  }

  @Test
  fun `a cancelled attempt propagates instead of being reported or projected`() {
    val runner = RecordingRunner(failure = CancellationException("work stopped"))
    val (worker, writes) = newWorker(runner)

    val thrown = runCatching { runBlocking { worker.doWork() } }.exceptionOrNull()

    assertTrue(
      "WorkManager must see a cancelled worker, not a fabricated outcome: expected a " +
        "CancellationException but got $thrown",
      thrown is CancellationException,
    )
    assertTrue("a cancelled attempt must not project an outcome", writes.isEmpty())
  }

  @Test
  fun `a status projection that throws still completes the attempt`() = runBlocking {
    val runner = RecordingRunner { it(OUTCOME_CLOSED) }
    val worker = TestListenableWorkerBuilder<SyncFloorWorker>(context).build().apply {
      attemptRunner = runner
      runtimeStatusWriter = { _, _, _, _, _ -> error("status write exploded") }
    }

    val result = worker.doWork()

    assertEquals(
      "a status-write failure must never turn a completed attempt into a retried one",
      ListenableWorker.Result.success(),
      result,
    )
  }

  @Test
  fun `a completed attempt persists the background_task trigger source`() = runBlocking {
    seedRuntimeStatusSchema()
    val runner = RecordingRunner { it(OUTCOME_CLOSED) }
    // The REAL projection, so this test proves the persisted row, not a fake's arguments.
    val worker = TestListenableWorkerBuilder<SyncFloorWorker>(context).build().apply { attemptRunner = runner }

    val result = worker.doWork()

    assertEquals(ListenableWorker.Result.success(), result)
    assertEquals(
      "the floor must never claim the foreground service's trigger source",
      "background_task",
      readRuntimeStatusColumn("last_trigger_source"),
    )
    assertEquals("3", readRuntimeStatusColumn("last_synced_count"))
    assertTrue("the attempt instant must be persisted", readRuntimeStatusColumn("last_attempt_at") != null)
  }

  /** Mirrors only the `sync_runtime_status` columns [SyncEngineRuntimeStatus] actually names. */
  private fun seedRuntimeStatusSchema() {
    val db = openAppDatabase(context)
    try {
      db.execSQL(
        "CREATE TABLE sync_runtime_status (" +
          "id INTEGER PRIMARY KEY DEFAULT 1 NOT NULL," +
          "last_attempt_at INTEGER," +
          "last_success_at INTEGER," +
          "last_failure_message TEXT," +
          "last_trigger_source TEXT," +
          "last_synced_count INTEGER DEFAULT 0 NOT NULL," +
          "is_cycle_active INTEGER DEFAULT 0 NOT NULL," +
          "last_backlog_read_count INTEGER DEFAULT 0 NOT NULL," +
          "last_cycle_id TEXT," +
          "last_cycle_stage TEXT," +
          "last_error_name TEXT," +
          "last_native_errcode_byte INTEGER," +
          "last_error_stage TEXT," +
          "consecutive_unclosed_cycles INTEGER DEFAULT 0 NOT NULL," +
          "last_cycle_stage_at INTEGER" +
          ")",
      )
    } finally {
      db.close()
    }
  }

  /** Reads one column of the singleton row, as a string, or `null` when the row does not exist. */
  private fun readRuntimeStatusColumn(column: String): String? {
    val db = openAppDatabase(context)
    try {
      db.rawQuery("SELECT $column FROM sync_runtime_status WHERE id = 1", null).use { cursor ->
        return if (cursor.moveToFirst()) cursor.getString(0) else null
      }
    } finally {
      db.close()
    }
  }
}
