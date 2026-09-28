package expo.modules.syncengine

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.multiprocess.RemoteCoroutineWorker
import androidx.work.testing.TestListenableWorkerBuilder
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

/**
 * Robolectric tests for the thin ADAPTER that [SyncFloorWorker] became: its injectable seams must
 * still reach [SyncFloorAttempt], and its result type must map to exactly the
 * `ListenableWorker.Result` the floor reported before the extraction.
 *
 * The attempt's own behavior -- ownership gate, exactly-once settlement, bounded wait,
 * `CancellationException` propagation, crash safety, the `background_task` projection -- is
 * asserted in [SyncFloorAttemptTest], driven directly on the collaborator with the same
 * assertions the pre-extraction worker tests used. The base class is now the remote
 * `androidx.work.multiprocess.RemoteCoroutineWorker`, so its local entry point is the suspend
 * `doRemoteWork()` (the base class owns `startRemoteWork()` and declares `startWork()` final);
 * [TestListenableWorkerBuilder] still constructs the adapter because the remote worker keeps the
 * ordinary `(Context, WorkerParameters)` constructor.
 *
 * The integration tests below still go through the worker's own `doRemoteWork()` entry point
 * (the remote base class's local suspend seam) precisely to prove the wiring: the real
 * `SyncFloorWorker` builds a [SyncFloorAttempt] from ITS seams, so a regression there -- a seam
 * silently dropped, or a context other than `applicationContext` handed over -- is a defect the
 * collaborator suite could not see. Result mapping itself is covered WITHOUT a worker instance by
 * [every attempt result maps to the worker result the floor reported before the extraction], so
 * that coverage survives any future base-class change.
 */
@RunWith(RobolectricTestRunner::class)
class SyncFloorWorkerTest {

  private lateinit var context: Context

  /** One recorded call to the worker's status-projection seam. */
  private data class StatusWrite(val triggerSource: String, val outcome: CycleOutcome)

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
  }

  /**
   * Fake [SyncAttemptRunner] recording the invocation's arguments and running [settle] so a test
   * can script "settles once" or "throws before settling" without any thread or timing
   * assumption.
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
  fun `the worker is a remote coroutine worker so the floor runs outside the calling process`() {
    // The base-class identity IS the process split: only a RemoteCoroutineWorker is driven by the
    // process hosting the bound RemoteWorkerService named in the request's input data. A plain
    // CoroutineWorker here would run the attempt -- and open autoreas.db -- in the calling process.
    val worker = TestListenableWorkerBuilder<SyncFloorWorker>(context).build()

    assertTrue(
      "SyncFloorWorker must be an androidx.work.multiprocess.RemoteCoroutineWorker",
      RemoteCoroutineWorker::class.java.isAssignableFrom(worker.javaClass),
    )
  }

  @Test
  fun `the worker adapter runs the attempt through its own seams and reports the completed tick as success`() = runBlocking {
    val runner = RecordingRunner { it(OUTCOME_CLOSED) }
    val (worker, writes) = newWorker(runner)

    val result = worker.doRemoteWork()

    assertEquals(
      "a settled attempt is a completed tick: the mapping must report success, as it did before the extraction",
      ListenableWorker.Result.success(),
      result,
    )
    assertEquals("the worker's own attemptRunner seam must reach the collaborator", 1, runner.invocationCount.get())
    assertEquals(SYNC_FLOOR_TRIGGER_SOURCE, runner.lastTriggerSource)
    assertEquals(true, runner.lastRequirePresence)
    assertEquals(
      "the worker's own runtimeStatusWriter seam must reach the collaborator",
      listOf(StatusWrite(SYNC_FLOOR_TRIGGER_SOURCE, OUTCOME_CLOSED)),
      writes,
    )
  }

  @Test
  fun `the worker adapter maps an unsettled attempt to retry`() = runBlocking {
    val runner = RecordingRunner()
    val (worker, writes) = newWorker(runner)
    worker.attemptTimeoutMsForTest = 20L

    val result = worker.doRemoteWork()

    assertEquals(
      "an unseen outcome must not be reported as success, and must not kill the periodic floor",
      ListenableWorker.Result.retry(),
      result,
    )
    assertTrue("no outcome was observed, so nothing may be projected", writes.isEmpty())
  }

  @Test
  fun `the worker adapter maps a skipped tick to success without running the attempt`() = runBlocking {
    val runner = RecordingRunner { it(OUTCOME_CLOSED) }
    val (worker, writes) = newWorker(runner)
    worker.ownsBackgroundCheck = { true }

    val result = worker.doRemoteWork()

    assertEquals(
      "a skipped tick is a completed tick, never a failed one: the period owns the next attempt",
      ListenableWorker.Result.success(),
      result,
    )
    assertEquals("no competing attempt may start while the ticker owns the background", 0, runner.invocationCount.get())
    assertTrue("a skipped tick must not touch sync_runtime_status", writes.isEmpty())
  }

  @Test
  fun `the worker adapter maps a runner that throws to retry`() = runBlocking {
    val runner = RecordingRunner(failure = IllegalStateException("runner exploded"))
    val (worker, writes) = newWorker(runner)

    val result = worker.doRemoteWork()

    assertEquals(ListenableWorker.Result.retry(), result)
    assertTrue(writes.isEmpty())
  }

  /**
   * The extraction's own behavior: the mapping from the collaborator's result type to the exact
   * `ListenableWorker.Result` the floor reported before the extraction. Driven directly on the
   * mapping, with no worker instance and no `WorkManager` in the way, so this coverage is
   * independent of the worker's base class.
   */
  @Test
  fun `every attempt result maps to the worker result the floor reported before the extraction`() {
    val mapped = listOf(
      SyncFloorAttemptResult.SkippedOwnedByTicker to ListenableWorker.Result.success(),
      SyncFloorAttemptResult.AttemptCompleted to ListenableWorker.Result.success(),
      SyncFloorAttemptResult.AttemptUnsettled to ListenableWorker.Result.retry(),
      SyncFloorAttemptResult.AttemptCrashed to ListenableWorker.Result.retry(),
    )

    mapped.forEach { (result, expected) ->
      assertEquals("$result must map to $expected", expected, result.toListenableWorkerResult())
    }
  }
}
