package expo.modules.syncengine

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
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
import java.io.File
import java.net.ServerSocket
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private const val JOURNAL_FILE_NAME_UNDER_TEST = "sync-journal.db"

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
}
