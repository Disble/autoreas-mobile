package expo.modules.syncengine

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import com.sun.net.httpserver.HttpServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowSystemClock
import java.io.File
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.time.Duration
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

private const val JOURNAL_FILE_NAME_UNDER_TEST = "sync-journal.db"

/**
 * Test-only budget ([SyncEngineRunner.budgetMsOverrideForTest]) for the tests that force the
 * watchdog to fire via [ShadowSystemClock.advanceBy] + [watchdogLooperForTest] idling, short
 * enough to keep the advance/idle window small.
 */
private const val SHORT_TEST_BUDGET_MS = 300L

/** How far past [SHORT_TEST_BUDGET_MS] the virtual clock is advanced, so the watchdog's deadline
 * comparison lands solidly past zero rather than exactly on the boundary. */
private const val CLOCK_ADVANCE_MARGIN_MS = 50L

private val CLOCK_ADVANCE = Duration.ofMillis(SHORT_TEST_BUDGET_MS + CLOCK_ADVANCE_MARGIN_MS)

/**
 * Bound for "the forced watchdog must have settled the attempt by now" waits in the two tests
 * below that hold a real bridge connection open. Deliberately kept UNDER [PRESENCE_PROBE_TIMEOUT_MS]
 * (1500 ms): that is the presence probe's OWN client-side connect/read timeout, which keeps
 * ticking in real wall-clock time regardless of how long the SERVER holds the connection open (a
 * held-open server does not make [SyncEngineHttp.get] itself block past its own timeout). A wait
 * bound at or above 1500 ms would let the probe's own natural timeout resolve the attempt first
 * (confounding the test with a real -- but unrelated -- "BridgePresenceRefused" outcome instead
 * of proving the forced watchdog fired); [ShadowSystemClock.advanceBy] + idling the watchdog
 * looper delivers the callback within milliseconds of real time, so this bound stays generous
 * for the behavior actually under test while staying safely under the confound.
 */
private const val WATCHDOG_FIRE_AWAIT_MS = 1_000L

/** Shorthand so test bodies read `watchdogLooperForTest()` instead of the fully qualified call. */
private fun watchdogLooperForTest(): Looper = SyncEngineRunner.watchdogLooperForTest()

/**
 * Robolectric tests for [SyncEngineRunner]: the process-wide singleton driving one native sync
 * attempt (ODD native-foreground-sync-service T1). Coverage here is the PRESENCE GATE
 * (`requirePresence = true`, T2/T14 native half) and the serialization guarantee two independent
 * callers (the module today, the foreground service from T3 tomorrow) rely on -- not the full
 * happy-path cycle (claim -> HTTP -> apply -> prune), which is [SyncEngineCycle]'s own concern
 * and out of this pass's scope.
 *
 * Each test seeds only the tables the exercised path actually touches, at the exact file
 * `filesDir/SQLite/autoreas.db` [openAppDatabase] resolves, mirroring the production schema
 * (`src/infrastructure/db/migrations/0000_moaning_maximus.sql` for `bridge_config`/
 * `operation_log`, `src/infrastructure/db/startup/startup.constants.ts`'s
 * `SYNC_CYCLE_LOCK_TABLE_SQL` for `sync_cycle_lock`).
 *
 * **Known Robolectric limitation on this host:** [SyncCycleLease.claim]'s `INSERT ... ON
 * CONFLICT DO UPDATE` (SQLite UPSERT) throws `near "ON": syntax error` under Robolectric
 * 4.14.1's bundled native SQLite here (verified directly against the exact production SQL
 * string). No test in this class exercises a successful lease claim as a result -- every
 * scenario either never reaches [SyncEngineCycle] (the presence-gate refusals) or reaches only
 * [SyncEngineCycle]'s pre-claim "not_applicable" fast path. The claimed-lease path (backlog
 * claim -> HTTP reconcile -> apply -> prune) is verified only by T7's real-device acceptance
 * pass, which runs against the platform's actual SQLite.
 *
 * **A second, newly-found Robolectric fact (ODD native-foreground-sync-service T3):**
 * `Handler.postDelayed` on ANY `Looper` -- including a genuinely separate, real-thread
 * `HandlerThread` such as [SyncEngineRunner]'s own watchdog thread -- does not deliver its
 * callback from REAL wall-clock waiting alone under this project's Robolectric configuration
 * (`SystemClock` runs as a shared virtual clock even for a background looper; verified directly
 * with a throwaway probe: a 500 ms `postDelayed` callback never fired within a real 5 s wait).
 * The watchdog CAN still be forced to fire deterministically, though: advance the shared virtual
 * clock with `org.robolectric.shadows.ShadowSystemClock.advanceBy(duration)`, then make the
 * WATCHDOG'S OWN looper (exposed for tests as [SyncEngineRunner.watchdogLooperForTest]) process
 * its now-due messages with `org.robolectric.Shadows.shadowOf(looper).idleFor(duration)`. The
 * tests below that need a real abandon use exactly that combination.
 */
@RunWith(RobolectricTestRunner::class)
class SyncEngineRunnerTest {

  private lateinit var context: Context

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    // See SyncEngineRunner.resetForTest's doc: the object is a process-wide singleton by
    // design, and this suite does not want to depend on whether Robolectric happens to give
    // each test method a fresh classloader -- every test starts from a known-empty runner.
    SyncEngineRunner.resetForTest()
  }

  @After
  fun tearDown() {
    SyncEngineRunner.resetForTest()
  }

  private fun journalFile(): File = File(context.filesDir, JOURNAL_FILE_NAME_UNDER_TEST)

  private fun freeButClosedPort(): Int {
    val socket = ServerSocket(0)
    val port = socket.localPort
    socket.close()
    return port
  }

  /**
   * Seeds the minimal app-database schema this test class needs: `bridge_config` (0 or 1 row),
   * `sync_cycle_lock` (empty; only [SyncEngineCycle]'s claim writes into it), and, only when a
   * caller needs the cycle to actually run, `operation_log` (kept empty here -- an empty
   * backlog is the pull-only path, which is all these tests need).
   */
  private fun seedAppSchema(
    ip: String? = null,
    port: String? = null,
    token: String? = null,
    deviceId: String? = null,
    withOperationLog: Boolean = false,
  ) {
    val db = openAppDatabase(context)
    try {
      db.execSQL(
        "CREATE TABLE bridge_config (" +
          "id INTEGER PRIMARY KEY DEFAULT 1 NOT NULL, ip TEXT, port INTEGER, token TEXT, " +
          "device_id TEXT, device_name TEXT, last_changelog_id INTEGER DEFAULT 0)",
      )
      db.execSQL(
        "CREATE TABLE sync_cycle_lock (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, " +
          "expires_at INTEGER NOT NULL, fence TEXT)",
      )
      if (withOperationLog) {
        db.execSQL(
          "CREATE TABLE operation_log (" +
            "id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, anime_id TEXT NOT NULL, " +
            "operation TEXT NOT NULL, payload TEXT NOT NULL, " +
            "status TEXT DEFAULT 'pending' NOT NULL, created_at INTEGER NOT NULL, " +
            "conflict_attempt_count INTEGER DEFAULT 0 NOT NULL)",
        )
      }
      if (ip != null) {
        db.execSQL(
          "INSERT INTO bridge_config (id, ip, port, token, device_id) VALUES (1, ?, ?, ?, ?)",
          arrayOf<Any?>(ip, port, token, deviceId),
        )
      }
    } finally {
      db.close()
    }
  }

  private fun lockRowCount(): Int {
    val db = openAppDatabase(context)
    try {
      db.rawQuery("SELECT COUNT(*) FROM sync_cycle_lock", null).use { cursor ->
        cursor.moveToFirst()
        return cursor.getInt(0)
      }
    } finally {
      db.close()
    }
  }

  /** Reads every journal row's `cycle_id`, oldest first (the autoincrement `id` IS that order:
   * [SyncEngineJournal.append] is `@Synchronized`, so concurrent appenders never interleave at
   * the row level either). Used by the serialization test below to prove ORDERING, not just
   * counts. */
  private fun readJournalCycleIdsInOrder(): List<String> {
    val db = SQLiteDatabase.openOrCreateDatabase(journalFile(), null)
    try {
      val ids = mutableListOf<String>()
      db.rawQuery("SELECT cycle_id FROM journal ORDER BY id ASC", null).use { cursor ->
        while (cursor.moveToNext()) {
          ids.add(cursor.getString(0))
        }
      }
      return ids
    } finally {
      db.close()
    }
  }

  /** Reads every journal row's `to_state` for ONE cycle id, oldest first. Used by the
   * queued-abandon test to prove a zombie cycle never ran: a watchdog abandon writes exactly one
   * row (`"abandoned"`); a cycle that ran afterward would add its own `"checked"`/`"not_applicable"`
   * (or further) rows on top of it. */
  private fun journalToStatesForCycle(cycleId: String): List<String> {
    if (!journalFile().exists()) return emptyList()
    val db = SQLiteDatabase.openOrCreateDatabase(journalFile(), null)
    try {
      val states = mutableListOf<String>()
      db.rawQuery(
        "SELECT to_state FROM journal WHERE cycle_id = ? ORDER BY id ASC",
        arrayOf(cycleId),
      ).use { cursor ->
        while (cursor.moveToNext()) {
          states.add(cursor.getString(0))
        }
      }
      return states
    } finally {
      db.close()
    }
  }

  @Test
  fun `requirePresence defaults to false when the caller omits it, exactly like SyncEngineModule's own call`() {
    // SyncEngineModule.runAttempt calls runOnce(context, triggerSource, cycleId, startMs) {... }
    // with NO requirePresence argument at all -- this is the only test exercising that omitted-
    // argument default, every other test in this file passes it explicitly.
    seedAppSchema(withOperationLog = true) // bridge_config exists but is empty

    val results = mutableListOf<CycleOutcome>()
    val latch = CountDownLatch(1)

    SyncEngineRunner.runOnce(
      context = context,
      triggerSource = "test",
      cycleId = "cycle-default-presence",
      startMs = System.currentTimeMillis(),
    ) { outcome ->
      results.add(outcome)
      latch.countDown()
    }

    assertTrue(latch.await(5, TimeUnit.SECONDS))
    // Same fast "not_applicable" as `requirePresence = false` explicitly: the gate never ran.
    assertEquals("not_applicable", results.single().outcome)
    assertNull(results.single().errorName)
  }

  // --- Task C.1 -------------------------------------------------------------------------------

  @Test
  fun `presence required, no bridge config, refuses without journal or lease writes`() {
    seedAppSchema() // bridge_config exists but is empty

    val results = mutableListOf<CycleOutcome>()
    val latch = CountDownLatch(1)

    SyncEngineRunner.runOnce(
      context = context,
      triggerSource = "test",
      cycleId = "cycle-1",
      startMs = System.currentTimeMillis(),
      requirePresence = true,
    ) { outcome ->
      results.add(outcome)
      latch.countDown()
    }
    shadowOf(Looper.getMainLooper()).idle()

    assertTrue("onResult should have fired synchronously", latch.await(2, TimeUnit.SECONDS))
    assertEquals(1, results.size)
    val outcome = results.single()
    assertEquals("not_applicable", outcome.outcome)
    assertEquals("BridgePresenceRefused", outcome.errorName)
    assertEquals("idle", outcome.stage)

    assertFalse("a refused probe must never even create the journal file", journalFile().exists())
    assertEquals("a refused probe must never touch the lease table", 0, lockRowCount())
  }

  // --- Task C.2 -------------------------------------------------------------------------------

  @Test
  fun `presence required, bridge points at an unreachable port, refuses within a bounded time`() {
    seedAppSchema(
      ip = "127.0.0.1",
      port = freeButClosedPort().toString(),
      token = "t",
      deviceId = "device-1",
    )

    val results = mutableListOf<CycleOutcome>()
    val latch = CountDownLatch(1)
    val startMs = System.currentTimeMillis()

    SyncEngineRunner.runOnce(
      context = context,
      triggerSource = "test",
      cycleId = "cycle-2",
      startMs = startMs,
      requirePresence = true,
    ) { outcome ->
      results.add(outcome)
      latch.countDown()
    }
    shadowOf(Looper.getMainLooper()).idle()

    assertTrue(latch.await(5, TimeUnit.SECONDS))
    val elapsedMs = System.currentTimeMillis() - startMs
    val outcome = results.single()
    assertEquals("not_applicable", outcome.outcome)
    assertEquals("BridgePresenceRefused", outcome.errorName)
    assertTrue(
      "expected elapsed ($elapsedMs ms) to stay under 2x the presence timeout + margin",
      elapsedMs < 2 * PRESENCE_PROBE_TIMEOUT_MS + 1_000,
    )
    assertFalse(journalFile().exists())
    assertEquals(0, lockRowCount())
  }

  // --- Task C.3 -------------------------------------------------------------------------------

  @Test
  fun `presence not required, no bridge config, reaches the cycle's own no-config outcome`() {
    seedAppSchema(withOperationLog = true) // bridge_config exists but is empty

    val results = mutableListOf<CycleOutcome>()
    val latch = CountDownLatch(1)

    SyncEngineRunner.runOnce(
      context = context,
      triggerSource = "test",
      cycleId = "cycle-3",
      startMs = System.currentTimeMillis(),
      requirePresence = false,
    ) { outcome ->
      results.add(outcome)
      latch.countDown()
    }

    assertTrue(latch.await(5, TimeUnit.SECONDS))
    val outcome = results.single()
    // SyncEngineCycle.runCycle's OWN no-config path: "not_applicable" with a null errorName --
    // never SyncEngineBridgePresence's "BridgePresenceRefused", because requirePresence = false
    // never calls the gate at all (SyncEngineRunner.runOnce only probes inside `if
    // (requirePresence)`).
    assertEquals("not_applicable", outcome.outcome)
    assertNull(outcome.errorName)
    assertEquals("not_applicable", outcome.stage)

    // Unlike the gated refusal, this path DOES reach the journal (SyncEngineCycle's "checked"
    // transition runs before the config read), proving the two refusal shapes are genuinely
    // different code paths and not just different labels on the same early return.
    assertTrue(journalFile().exists())
  }

  // --- Task C.4 -------------------------------------------------------------------------------

  @Test
  fun `two runOnce calls never overlap and each delivers exactly one result`() {
    // Empty bridge_config (0 rows): SyncEngineCycle's own fast "not_applicable" path
    // (readBridgeConfig returns null), which never reaches SyncCycleLease.claim() or any HTTP
    // call. Deliberate: SyncCycleLease.claim() issues an `INSERT ... ON CONFLICT DO UPDATE`
    // (SQLite UPSERT, added in SQLite 3.24) that THROWS `near "ON": syntax error` under
    // Robolectric 4.14.1's bundled native SQLite on this host (verified directly with the exact
    // production SQL string against a freshly seeded table: `android.database.sqlite.
    // SQLiteException: ... near "ON": syntax error (code 1 SQLITE_ERROR)`) -- a genuine
    // Robolectric/host limitation, not a production bug; T7's real-device acceptance pass
    // exercises the real lease claim against the platform's actual SQLite. Consequently this
    // suite cannot exercise SyncEngineCycle beyond its pre-lease-claim steps; see the module's
    // task report for what remains covered only by T7.
    seedAppSchema(withOperationLog = true)

    val results = Collections.synchronizedList(mutableListOf<CycleOutcome>())
    val startLatch = CountDownLatch(1)
    val doneLatch = CountDownLatch(2)

    fun fire(cycleId: String) = Thread {
      startLatch.await()
      SyncEngineRunner.runOnce(
        context = context,
        triggerSource = "test",
        cycleId = cycleId,
        startMs = System.currentTimeMillis(),
        requirePresence = false,
      ) { outcome ->
        results.add(outcome)
        doneLatch.countDown()
      }
    }

    val threadA = fire("cycle-a")
    val threadB = fire("cycle-b")
    threadA.start()
    threadB.start()
    startLatch.countDown() // releases both callers at (as close as the JVM allows to) once

    assertTrue("both attempts should complete", doneLatch.await(10, TimeUnit.SECONDS))
    threadA.join(1_000)
    threadB.join(1_000)

    assertEquals("each call must deliver exactly one result", 2, results.size)
    assertTrue(
      "both attempts must reach the cycle's own no-config outcome",
      results.all { it.outcome == "not_applicable" && it.errorName == null },
    )

    // The DEFINITIVE serialization proof, and the reason this test does not just count HTTP
    // calls: it reads BOTH cycles' full journal history, in insertion order (the journal's
    // autoincrement `id` IS that order -- SyncEngineJournal.append is `@Synchronized`), and
    // asserts the two cycles' "checked"/"not_applicable" row pairs are never interleaved. Two
    // genuinely concurrent SyncEngineCycle.run() calls could freely interleave those pairs;
    // only the shared single-thread `worker` executor's FIFO contract (see SyncEngineRunner's
    // class doc) forces one cycle's whole pair to finish before the other's begins. This is a
    // structural proof, not a timing race: if [SyncEngineRunner] ever regressed to a per-call
    // executor, this assertion would fail deterministically, not flakily.
    val transitions = readJournalCycleIdsInOrder()
    assertEquals("expected exactly 2 rows per cycle (checked, not_applicable)", 4, transitions.size)
    assertEquals(
      "the first cycle's two journal rows must be contiguous (never interleaved)",
      transitions[0],
      transitions[1],
    )
    assertEquals(
      "the second cycle's two journal rows must be contiguous (never interleaved)",
      transitions[2],
      transitions[3],
    )
    assertTrue(
      "the two cycles' row blocks must not overlap",
      transitions[0] != transitions[2],
    )
  }

  // --- ODD native-foreground-sync-service T3 -------------------------------------------------
  // The presence probe's HTTP call must run on SyncEngineRunner's own worker thread, never the
  // caller's (T1+T2 diff review); the watchdog must arm at ENQUEUE, on the caller's thread,
  // covering the full queue wait + probe + cycle span (corrected by the parent review after an
  // earlier T3 attempt armed it only once worker started the attempt -- see the class doc); and
  // every settlement path must go through the same settled CAS so onResult never fires twice.

  @Test
  fun `runOnce returns before a slow presence probe could possibly have completed`() {
    // Proves the gate no longer runs on the CALLER's thread: if it did, this call would block
    // for as long as the server takes to answer (here, until the test releases it) -- exactly
    // the shape of a real Android main-thread caller (SyncForegroundService.onStartCommand)
    // that would instead throw NetworkOnMainThreadException. Robolectric does not enforce that
    // exception (its host-JVM networking has no BlockGuard integration), so this test proves the
    // underlying claim the exception exists to protect -- the caller is never blocked -- rather
    // than the exception itself.
    val releaseServer = CountDownLatch(1)
    val attemptDone = CountDownLatch(1)
    val srv = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    srv.executor = Executors.newCachedThreadPool()
    srv.createContext("/api/status") { exchange ->
      releaseServer.await(5, TimeUnit.SECONDS)
      exchange.sendResponseHeaders(200, -1)
      exchange.close()
    }
    srv.start()

    try {
      // deviceId intentionally omitted: complete enough for the presence probe (ip/port/token),
      // incomplete for SyncEngineCycle's own connection check, so this attempt -- once the probe
      // eventually resolves -- takes the cycle's fast "not_applicable" path and never reaches
      // SyncCycleLease.claim() (the known Robolectric UPSERT limitation; see the class doc).
      seedAppSchema(ip = "127.0.0.1", port = srv.address.port.toString(), token = "t")

      val callStartNanos = System.nanoTime()
      SyncEngineRunner.runOnce(
        context = context,
        triggerSource = "test",
        cycleId = "cycle-thread",
        startMs = System.currentTimeMillis(),
        requirePresence = true,
      ) { attemptDone.countDown() }
      val callElapsedMs = (System.nanoTime() - callStartNanos) / 1_000_000

      assertTrue(
        "runOnce() took $callElapsedMs ms to return; it must return almost immediately " +
          "(well under the ${PRESENCE_PROBE_TIMEOUT_MS}ms probe budget) because the probe now " +
          "runs on the worker thread, not the caller's",
        callElapsedMs < PRESENCE_PROBE_TIMEOUT_MS / 2,
      )
    } finally {
      releaseServer.countDown()
      assertTrue("the attempt must still settle once the server answers", attemptDone.await(5, TimeUnit.SECONDS))
      srv.stop(0)
    }
  }

  @Test
  fun `an attempt whose budget expires while still queued resolves abandoned and never runs a zombie cycle`() {
    // Reproduces exactly the scenario the parent review caught: worker parked inside a PRIOR
    // attempt's native call (cycle-a, held open by releaseA below) for the whole budget, so
    // cycle-b's own worker.execute closure never even STARTS while it is queued behind cycle-a.
    // The watchdog is armed at ENQUEUE (on the caller's thread, per the corrected fix), so
    // cycle-b's watchdog exists and can fire even though its closure has not run yet -- proven
    // here by forcing it to fire deterministically (ShadowSystemClock.advanceBy + idling the
    // watchdog's OWN looper; see the class doc) while cycle-a is still held open. Once cycle-a is
    // released and worker finally reaches cycle-b's closure, it must find settled already true
    // and run NEITHER the probe NOR the cycle: the journal must show exactly the one "abandoned"
    // row the watchdog itself wrote, never a "checked"/"not_applicable" pair from a zombie cycle.
    val releaseA = CountDownLatch(1)
    val srv = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    srv.executor = Executors.newCachedThreadPool()
    srv.createContext("/api/status") { exchange ->
      releaseA.await(10, TimeUnit.SECONDS)
      exchange.sendResponseHeaders(200, -1)
      exchange.close()
    }
    srv.start()

    try {
      // deviceId intentionally omitted: complete enough for the presence probe (ip/port/token),
      // incomplete for SyncEngineCycle's own connection check -- not that cycle-b should ever
      // reach SyncEngineCycle at all here, but it keeps cycle-a's own eventual resolution off the
      // Robolectric UPSERT limitation too (see the class doc).
      seedAppSchema(ip = "127.0.0.1", port = srv.address.port.toString(), token = "t")

      val resultsA = mutableListOf<CycleOutcome>()
      val latchA = CountDownLatch(1)
      // Called BEFORE the override is set, so cycle-a gets the real 30 s production budget --
      // the clock advance below must abandon cycle-b only, not cycle-a.
      SyncEngineRunner.runOnce(
        context = context,
        triggerSource = "test",
        cycleId = "cycle-a",
        startMs = System.currentTimeMillis(),
        requirePresence = true, // occupies worker until releaseA fires, via the probe above
      ) { outcome -> resultsA.add(outcome); latchA.countDown() }

      SyncEngineRunner.budgetMsOverrideForTest = SHORT_TEST_BUDGET_MS

      // Enqueued immediately after, on the SAME thread: worker is a single-thread FIFO executor,
      // so this deterministically queues behind cycle-a without needing separate threads.
      val resultsB = mutableListOf<CycleOutcome>()
      val latchB = CountDownLatch(1)
      SyncEngineRunner.runOnce(
        context = context,
        triggerSource = "test",
        cycleId = "cycle-b",
        startMs = System.currentTimeMillis(),
        requirePresence = false,
      ) { outcome -> resultsB.add(outcome); latchB.countDown() }

      // Force cycle-b's watchdog to fire WHILE cycle-a is still held open -- worker cannot
      // possibly have reached cycle-b's closure yet, since it is blocked inside cycle-a's probe.
      ShadowSystemClock.advanceBy(CLOCK_ADVANCE)
      shadowOf(watchdogLooperForTest()).idleFor(CLOCK_ADVANCE)

      assertTrue("cycle-b's watchdog must have fired", latchB.await(WATCHDOG_FIRE_AWAIT_MS, TimeUnit.MILLISECONDS))
      val outcomeB = resultsB.single()
      assertEquals("abandoned", outcomeB.outcome)
      assertEquals(
        "the watchdog must write exactly one journal row for cycle-b",
        listOf("abandoned"),
        journalToStatesForCycle("cycle-b"),
      )

      // Now let cycle-a finish and give worker a moment to reach cycle-b's now-queued closure
      // for real: it must skip it (settled is already true) rather than run a zombie cycle.
      releaseA.countDown()
      assertTrue("cycle-a must complete", latchA.await(5, TimeUnit.SECONDS))
      Thread.sleep(500)

      assertEquals(
        "cycle-b's journal history must be UNCHANGED after cycle-a releases: worker finding " +
          "settled already true must run neither the probe nor the cycle for cycle-b",
        listOf("abandoned"),
        journalToStatesForCycle("cycle-b"),
      )
    } finally {
      releaseA.countDown()
      srv.stop(0)
    }
  }

  @Test
  fun `presence refusal resolves exactly once even when the watchdog fires while the probe is in flight`() {
    // Reproduces the second bug the parent review caught: the presence-refusal branch used to
    // call onResult directly, without going through settled -- so if the watchdog ALSO fired
    // (racing a genuinely in-flight probe), onResult could fire twice. Forces that exact race:
    // the watchdog is made to fire (deterministically, via the same clock-advance mechanism)
    // while the probe's HTTP call is confirmed in flight (probeStarted below), then the held
    // connection is closed without a response so the probe eventually resolves to a REAL
    // transport-failure refusal. onResult must have fired exactly once, for the watchdog's
    // "abandoned" -- the later refusal must lose the settled CAS and do nothing.
    val probeStarted = CountDownLatch(1)
    val releaseProbe = CountDownLatch(1)
    val srv = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    srv.executor = Executors.newCachedThreadPool()
    srv.createContext("/api/status") { exchange ->
      probeStarted.countDown()
      releaseProbe.await(10, TimeUnit.SECONDS)
      // Closed WITHOUT ever calling sendResponseHeaders: the client's blocking read sees the
      // connection end mid-exchange, a genuine transport failure (not a clean 200/4xx/5xx).
      exchange.close()
    }
    srv.start()

    try {
      seedAppSchema(ip = "127.0.0.1", port = srv.address.port.toString(), token = "t")
      SyncEngineRunner.budgetMsOverrideForTest = SHORT_TEST_BUDGET_MS

      val results = mutableListOf<CycleOutcome>()
      val latch = CountDownLatch(1)
      SyncEngineRunner.runOnce(
        context = context,
        triggerSource = "test",
        cycleId = "cycle-race",
        startMs = System.currentTimeMillis(),
        requirePresence = true,
      ) { outcome -> results.add(outcome); latch.countDown() }

      assertTrue("the probe must genuinely be in flight before forcing the watchdog", probeStarted.await(5, TimeUnit.SECONDS))

      ShadowSystemClock.advanceBy(CLOCK_ADVANCE)
      shadowOf(watchdogLooperForTest()).idleFor(CLOCK_ADVANCE)

      assertTrue("the watchdog must settle the attempt", latch.await(WATCHDOG_FIRE_AWAIT_MS, TimeUnit.MILLISECONDS))

      // Now let the held probe fail for real; the refusal branch must lose the settled race.
      releaseProbe.countDown()
      Thread.sleep(500)

      assertEquals("onResult must fire EXACTLY once", 1, results.size)
      assertEquals("abandoned", results.single().outcome)
    } finally {
      releaseProbe.countDown()
      srv.stop(0)
    }
  }
}
