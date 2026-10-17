package expo.modules.syncengine

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** The columns `sync_runtime_status` keeps from migration 0020 on (convergent-sync T18). */
private const val CURRENT_RUNTIME_STATUS_TABLE_SQL =
  "CREATE TABLE sync_runtime_status (" +
    "id INTEGER PRIMARY KEY DEFAULT 1 NOT NULL," +
    "registration_status TEXT DEFAULT 'unregistered' NOT NULL," +
    "execution_mode TEXT DEFAULT 'best_effort_background_task' NOT NULL," +
    "can_show_persistent_notification INTEGER DEFAULT 0 NOT NULL," +
    "last_attempt_at INTEGER," +
    "last_success_at INTEGER," +
    "last_cycle_id TEXT," +
    "last_cycle_stage TEXT," +
    "last_error_name TEXT" +
    ")"

/**
 * The columns 0020 drops, with the shape a device that has not opened the app since the update
 * still holds (migrations 0002-0015 plus the repair-only columns).
 */
private val DROPPED_RUNTIME_STATUS_COLUMNS = listOf(
  "is_foreground_service_running INTEGER DEFAULT 0 NOT NULL",
  "last_failure_message TEXT",
  "last_trigger_source TEXT",
  "last_synced_count INTEGER DEFAULT 0 NOT NULL",
  "foreground_service_callback_started_at INTEGER",
  "last_no_op_reason TEXT",
  "last_pending_operations_count_at_start INTEGER",
  "is_cycle_active INTEGER DEFAULT 0 NOT NULL",
  "last_backlog_read_count INTEGER DEFAULT 0 NOT NULL",
  "last_pruned_operations_count INTEGER DEFAULT 0 NOT NULL",
  "is_background_task_registered INTEGER DEFAULT 0 NOT NULL",
  "last_native_errcode_byte INTEGER",
  "last_error_stage TEXT",
  "consecutive_unclosed_cycles INTEGER DEFAULT 0 NOT NULL",
  "last_cycle_stage_at INTEGER",
  "last_failed_checkpoint_count INTEGER DEFAULT 0 NOT NULL",
  "last_diagnostics_discarded_count INTEGER",
  "last_diagnostics_undeliverable_count INTEGER",
  "last_diagnostics_unclassified_count INTEGER",
  "last_diagnostics_reaped_count INTEGER",
  "last_diagnostics_failed_removal_count INTEGER",
  "last_outbox_failed_write_count INTEGER",
  "last_dead_letter_count INTEGER",
  "last_conflict_exhausted_count INTEGER",
  "last_stuck_processing_count INTEGER",
  "last_oldest_pending_age_ms INTEGER",
  "last_pending_row_count INTEGER",
)

/**
 * Robolectric tests for [SyncEngineRuntimeStatus] (ODD native-foreground-sync-service T6): the
 * native projection of one attempt into the app's `sync_runtime_status` singleton row. Each test
 * seeds the table at the exact file [openAppDatabase] resolves, either with the columns kept from
 * migration 0020 on or with the pre-0020 shape that still carries every dropped column: the writer
 * must work on both, and must never name a dropped column (convergent-sync T18).
 *
 * Unlike [SyncEngineRunnerTest], this class needs no `@SQLiteMode(NATIVE)` override: [writeRow]
 * never issues `INSERT ... ON CONFLICT DO UPDATE` (the SQLite UPSERT syntax Robolectric's bundled
 * SQLite rejects here), only a plain `UPDATE` followed by a plain `INSERT` when it affected zero
 * rows -- both run fine under the default bundled SQLite.
 */
@RunWith(RobolectricTestRunner::class)
class SyncEngineRuntimeStatusTest {

  private lateinit var context: Context

  private fun setUpContext() {
    context = ApplicationProvider.getApplicationContext()
  }

  /** Creates the table (current shape, or the pre-0020 shape when [legacy]) and stamps readiness. */
  private fun seedRuntimeStatusSchema(legacy: Boolean = false) {
    val db = openAppDatabase(context)
    try {
      db.execSQL(CURRENT_RUNTIME_STATUS_TABLE_SQL)
      if (legacy) {
        DROPPED_RUNTIME_STATUS_COLUMNS.forEach { column ->
          db.execSQL("ALTER TABLE sync_runtime_status ADD COLUMN $column")
        }
      }
      // T3 tail: the foreground's durable readiness stamp. Without it the writer refuses, which
      // is exactly what the dedicated not-ready test below exercises deliberately.
      db.execSQL("PRAGMA user_version = $EXPECTED_SCHEMA_READINESS_VERSION")
    } finally {
      db.close()
    }
  }

  private fun seedRuntimeStatusRow(values: Map<String, Any?>) {
    val db = openAppDatabase(context)
    try {
      val columns = values.keys.joinToString(",")
      val placeholders = values.keys.joinToString(",") { "?" }
      db.execSQL(
        "INSERT INTO sync_runtime_status ($columns) VALUES ($placeholders)",
        values.values.toTypedArray(),
      )
    } finally {
      db.close()
    }
  }

  /** Reads every column of the singleton row, as text, or `null` when no row exists. */
  private fun readRow(): Map<String, String?>? {
    val db = openAppDatabase(context)
    try {
      db.rawQuery("SELECT * FROM sync_runtime_status WHERE id = 1", null).use { cursor ->
        if (!cursor.moveToFirst()) return null
        return cursor.columnNames.associateWith { column ->
          val index = cursor.getColumnIndexOrThrow(column)
          if (cursor.isNull(index)) null else cursor.getString(index)
        }
      }
    } finally {
      db.close()
    }
  }

  private fun rowCount(): Int {
    val db = openAppDatabase(context)
    try {
      db.rawQuery("SELECT COUNT(*) FROM sync_runtime_status", null).use { cursor ->
        cursor.moveToFirst()
        return cursor.getInt(0)
      }
    } finally {
      db.close()
    }
  }

  /** A non-default value for every dropped column, so a write to any of them would show. */
  private fun droppedColumnSeed(): Map<String, Any?> =
    DROPPED_RUNTIME_STATUS_COLUMNS.associate { definition ->
      val name = definition.substringBefore(' ')
      name to if (definition.contains(" TEXT")) "seed-$name" else 41
    }

  @Test
  fun `a completed attempt inserts the singleton row when none existed`() {
    setUpContext()
    seedRuntimeStatusSchema()

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-success",
      1_000L,
      CycleOutcome("closed", "closed", 4, 6, null),
    )

    assertEquals(
      mapOf(
        "id" to "1",
        "registration_status" to "unregistered",
        "execution_mode" to "best_effort_background_task",
        "can_show_persistent_notification" to "0",
        "last_attempt_at" to "1000",
        "last_success_at" to "1000",
        "last_cycle_id" to "cycle-success",
        "last_cycle_stage" to "closed",
        "last_error_name" to null,
      ),
      readRow(),
    )
  }

  @Test
  fun `a completed attempt updates an existing row without touching unrelated columns`() {
    setUpContext()
    seedRuntimeStatusSchema()
    seedRuntimeStatusRow(
      mapOf(
        "id" to 1,
        "registration_status" to "registered",
        "execution_mode" to "android_foreground_service",
        "can_show_persistent_notification" to 1,
        "last_error_name" to "ReconcileHttpError",
      ),
    )

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-success-2",
      2_000L,
      CycleOutcome("closed", "closed", 1, 1, null),
    )

    val row = readRow() ?: error("row must still exist")
    assertEquals(
      "this writer's scope is the attempt columns; registration/runtime flags stay JS's job",
      "registered",
      row["registration_status"],
    )
    assertEquals("android_foreground_service", row["execution_mode"])
    assertEquals("1", row["can_show_persistent_notification"])
    assertEquals("2000", row["last_attempt_at"])
    assertEquals("2000", row["last_success_at"])
    assertNull("a success clears the previous error class", row["last_error_name"])
  }

  @Test
  fun `on a pre-0020 table every dropped column keeps its value through success and failure`() {
    setUpContext()
    seedRuntimeStatusSchema(legacy = true)
    val seed = droppedColumnSeed()
    seedRuntimeStatusRow(mapOf("id" to 1) + seed)

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-legacy-success",
      3_000L,
      CycleOutcome("closed", "closed", 2, 2, null),
    )
    SyncEngineRuntimeStatus.record(
      context,
      "cycle-legacy-failure",
      4_000L,
      CycleOutcome("failed", "sent", 0, 0, "ReconcileHttpError"),
    )

    val row = readRow() ?: error("row must still exist")
    seed.forEach { (column, value) ->
      assertEquals("the writer must never name the dropped column $column", value.toString(), row[column])
    }
    assertEquals("4000", row["last_attempt_at"])
    assertEquals("3000", row["last_success_at"])
    assertEquals("cycle-legacy-failure", row["last_cycle_id"])
    assertEquals("sent", row["last_cycle_stage"])
    assertEquals("ReconcileHttpError", row["last_error_name"])
  }

  @Test
  fun `on a pre-0020 table a first attempt inserts the row with the dropped columns at their defaults`() {
    setUpContext()
    seedRuntimeStatusSchema(legacy = true)

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-legacy-insert",
      5_000L,
      CycleOutcome("closed", "closed", 1, 1, null),
    )

    val row = readRow() ?: error("expected the singleton row to have been inserted")
    assertEquals("5000", row["last_success_at"])
    assertEquals("0", row["is_cycle_active"])
    assertEquals("0", row["consecutive_unclosed_cycles"])
    assertEquals("0", row["last_synced_count"])
    assertNull(row["last_trigger_source"])
    assertNull(row["last_failure_message"])
  }

  @Test
  fun `a failed attempt leaves the last success untouched`() {
    setUpContext()
    seedRuntimeStatusSchema()
    seedRuntimeStatusRow(mapOf("id" to 1, "last_success_at" to 500))

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-fail",
      9_000L,
      CycleOutcome("failed", "sent", 0, 0, "ReconcileHttpError"),
    )

    val row = readRow() ?: error("row must still exist")
    assertEquals(
      "a failed attempt must never erase the last successful cycle's instant",
      "500",
      row["last_success_at"],
    )
    assertEquals("9000", row["last_attempt_at"])
    assertEquals("cycle-fail", row["last_cycle_id"])
    assertEquals("ReconcileHttpError", row["last_error_name"])
    assertEquals("sent", row["last_cycle_stage"])
  }

  @Test
  fun `an abandoned attempt with no error name records no error class`() {
    setUpContext()
    seedRuntimeStatusSchema()

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-abandoned",
      3_000L,
      CycleOutcome("abandoned", "idle", 0, 0, null),
    )

    val row = readRow() ?: error("expected the singleton row to have been inserted")
    assertNull(row["last_error_name"])
    assertNull(row["last_success_at"])
    assertEquals("idle", row["last_cycle_stage"])
  }

  @Test
  fun `a refused-presence not_applicable outcome writes nothing when no row existed`() {
    setUpContext()
    seedRuntimeStatusSchema()

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-refused",
      4_000L,
      CycleOutcome("not_applicable", "idle", 0, 0, "BridgePresenceRefused"),
    )

    assertEquals(
      "mirrors the retired JS attempt-policy gate: a refused tick must never create the row",
      0,
      rowCount(),
    )
  }

  @Test
  fun `a refused-presence not_applicable outcome leaves an existing row byte-for-byte unchanged`() {
    setUpContext()
    seedRuntimeStatusSchema()
    seedRuntimeStatusRow(
      mapOf(
        "id" to 1,
        "last_attempt_at" to 111,
        "last_success_at" to 111,
        "last_cycle_id" to "cycle-before",
      ),
    )
    val before = readRow()

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-refused-2",
      5_000L,
      CycleOutcome("not_applicable", "idle", 0, 0, "BridgePresenceRefused"),
    )

    assertEquals(
      "mirrors the retired JS gate: a refused tick must never touch the singleton row",
      before,
      readRow(),
    )
  }

  @Test
  fun `a status-write failure never throws`() {
    setUpContext()
    // The file exists and is stamped ready, but sync_runtime_status does not exist: the write
    // itself throws "no such table" and record() must swallow it, not propagate it.
    val seedDb = openAppDatabase(context)
    try {
      seedDb.execSQL("PRAGMA user_version = $EXPECTED_SCHEMA_READINESS_VERSION")
    } finally {
      seedDb.close()
    }

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-missing-table",
      6_000L,
      CycleOutcome("closed", "closed", 1, 1, null),
    )

    assertTrue("record() must return normally even when the write itself fails", true)
  }

  // --- T3 tail: foreground schema-readiness gate ---------------------------------------------
  // The status writer must never create `autoreas.db` and never write into one the foreground has
  // not durably stamped ready. Both cases below assert the database is genuinely untouched.

  @Test
  fun `does not create the app database when the file is absent`() {
    setUpContext()

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-not-provisioned",
      7_000L,
      CycleOutcome("closed", "closed", 1, 1, null),
    )

    assertFalse(
      "a missing database must never be created by the status writer",
      resolveAppDatabaseFile(context).exists(),
    )
  }

  @Test
  fun `does not write when the schema is not ready`() {
    setUpContext()
    seedRuntimeStatusSchema()
    // Rewind readiness below the expected stamp: the singleton table exists, so a writer that
    // ignored readiness WOULD persist a row here and this test would see it.
    val seedDb = openAppDatabase(context)
    try {
      seedDb.execSQL("PRAGMA user_version = ${EXPECTED_SCHEMA_READINESS_VERSION - 1}")
    } finally {
      seedDb.close()
    }

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-schema-not-ready",
      8_000L,
      CycleOutcome("closed", "closed", 3, 4, null),
    )

    assertEquals(
      "a not-ready database must not receive a status row",
      0,
      rowCount(),
    )
  }
}
