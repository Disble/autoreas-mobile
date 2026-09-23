package expo.modules.syncengine

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Robolectric tests for [SyncEngineRuntimeStatus] (ODD native-foreground-sync-service T6): the
 * native projection of one [SyncForegroundService] attempt into the app's `sync_runtime_status`
 * singleton row. Each test seeds the table at the exact file [openAppDatabase] resolves, mirroring
 * production's full column set (`src/infrastructure/db/migrations/0002_add_sync_runtime_status.sql`
 * through `0013_add_convergence_instrumentation_columns.sql`, plus the `is_background_task_registered`
 * repair column) so an assertion that "an unrelated column stayed untouched" is checked against a
 * real column, not a test-only stand-in.
 *
 * Unlike [SyncEngineRunnerTest], this class needs no `@SQLiteMode(NATIVE)` override: [writeRow]
 * never issues `INSERT ... ON CONFLICT DO UPDATE` (the SQLite UPSERT syntax Robolectric's bundled
 * SQLite rejects here), only a plain `UPDATE` followed by a plain `INSERT` when it affected zero
 * rows -- both run fine under the default bundled SQLite.
 */
@RunWith(RobolectricTestRunner::class)
class SyncEngineRuntimeStatusTest {

  private lateinit var context: Context

  private val fixedColumns = listOf(
    "id",
    "registration_status",
    "execution_mode",
    "is_foreground_service_running",
    "can_show_persistent_notification",
    "last_attempt_at",
    "last_success_at",
    "last_failure_message",
    "last_trigger_source",
    "last_synced_count",
    "is_cycle_active",
    "last_backlog_read_count",
    "last_pruned_operations_count",
    "is_background_task_registered",
    "last_cycle_id",
    "last_cycle_stage",
    "last_error_name",
    "last_native_errcode_byte",
    "last_error_stage",
    "consecutive_unclosed_cycles",
    "last_cycle_stage_at",
    "last_failed_checkpoint_count",
    "last_diagnostics_discarded_count",
    "last_diagnostics_failed_removal_count",
    "last_outbox_failed_write_count",
    "last_dead_letter_count",
    "last_conflict_exhausted_count",
    "last_stuck_processing_count",
    "last_oldest_pending_age_ms",
    "last_pending_row_count",
  )

  private fun setUpContext() {
    context = ApplicationProvider.getApplicationContext()
  }

  /** Mirrors the production `sync_runtime_status` schema byte for byte (every migration from
   * `0002_add_sync_runtime_status.sql` through `0013_add_convergence_instrumentation_columns.sql`,
   * plus the `is_background_task_registered` repair column from `client.constants.ts`). */
  private fun seedRuntimeStatusSchema() {
    val db = openAppDatabase(context)
    try {
      db.execSQL(
        "CREATE TABLE sync_runtime_status (" +
          "id INTEGER PRIMARY KEY DEFAULT 1 NOT NULL," +
          "registration_status TEXT DEFAULT 'unregistered' NOT NULL," +
          "execution_mode TEXT DEFAULT 'best_effort_background_task' NOT NULL," +
          "is_foreground_service_running INTEGER DEFAULT 0 NOT NULL," +
          "can_show_persistent_notification INTEGER DEFAULT 0 NOT NULL," +
          "last_attempt_at INTEGER," +
          "last_success_at INTEGER," +
          "last_failure_message TEXT," +
          "last_trigger_source TEXT," +
          "last_synced_count INTEGER DEFAULT 0 NOT NULL," +
          "is_cycle_active INTEGER DEFAULT 0 NOT NULL," +
          "last_backlog_read_count INTEGER DEFAULT 0 NOT NULL," +
          "last_pruned_operations_count INTEGER DEFAULT 0 NOT NULL," +
          "is_background_task_registered INTEGER DEFAULT 0 NOT NULL," +
          "last_cycle_id TEXT," +
          "last_cycle_stage TEXT," +
          "last_error_name TEXT," +
          "last_native_errcode_byte INTEGER," +
          "last_error_stage TEXT," +
          "consecutive_unclosed_cycles INTEGER DEFAULT 0 NOT NULL," +
          "last_cycle_stage_at INTEGER," +
          "last_failed_checkpoint_count INTEGER DEFAULT 0 NOT NULL," +
          "last_diagnostics_discarded_count INTEGER," +
          "last_diagnostics_failed_removal_count INTEGER," +
          "last_outbox_failed_write_count INTEGER," +
          "last_dead_letter_count INTEGER," +
          "last_conflict_exhausted_count INTEGER," +
          "last_stuck_processing_count INTEGER," +
          "last_oldest_pending_age_ms INTEGER," +
          "last_pending_row_count INTEGER" +
          ")",
      )
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

  private fun readRow(): Map<String, Any?>? {
    val db = openAppDatabase(context)
    try {
      db.rawQuery("SELECT * FROM sync_runtime_status WHERE id = 1", null).use { cursor ->
        if (!cursor.moveToFirst()) return null
        return fixedColumns.associateWith { column ->
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

    val row = readRow() ?: error("expected the singleton row to have been inserted")
    assertEquals("1000", row["last_attempt_at"])
    assertEquals("1000", row["last_success_at"])
    assertNull(row["last_failure_message"])
    assertEquals("foreground_service", row["last_trigger_source"])
    assertEquals("4", row["last_synced_count"])
    assertEquals("6", row["last_backlog_read_count"])
    assertEquals("cycle-success", row["last_cycle_id"])
    assertEquals("closed", row["last_cycle_stage"])
    assertEquals("1000", row["last_cycle_stage_at"])
    assertNull(row["last_error_name"])
    assertNull(row["last_error_stage"])
    assertNull(row["last_native_errcode_byte"])
    assertEquals("0", row["consecutive_unclosed_cycles"])
    assertEquals("0", row["is_cycle_active"])
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
        "is_foreground_service_running" to 1,
        "last_diagnostics_discarded_count" to 5,
        "last_pruned_operations_count" to 9,
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
    assertEquals("1", row["is_foreground_service_running"])
    assertEquals("5", row["last_diagnostics_discarded_count"])
    assertEquals("9", row["last_pruned_operations_count"])
    assertEquals("2000", row["last_attempt_at"])
    assertEquals("2000", row["last_success_at"])
  }

  @Test
  fun `a failed attempt leaves the last success counters untouched`() {
    setUpContext()
    seedRuntimeStatusSchema()
    seedRuntimeStatusRow(
      mapOf(
        "id" to 1,
        "last_success_at" to 500,
        "last_synced_count" to 7,
        "last_backlog_read_count" to 3,
      ),
    )

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-fail",
      9_000L,
      CycleOutcome("failed", "sent", 0, 0, "ReconcileHttpError"),
    )

    val row = readRow() ?: error("row must still exist")
    assertEquals(
      "a failed attempt must never erase the last successful cycle's own numbers",
      "500",
      row["last_success_at"],
    )
    assertEquals("7", row["last_synced_count"])
    assertEquals("3", row["last_backlog_read_count"])
    assertEquals("9000", row["last_attempt_at"])
    assertEquals("Native sync attempt failed: ReconcileHttpError at stage 'sent'", row["last_failure_message"])
    assertEquals("ReconcileHttpError", row["last_error_name"])
    assertEquals("sent", row["last_cycle_stage"])
    assertEquals("0", row["consecutive_unclosed_cycles"])
    assertEquals("0", row["is_cycle_active"])
  }

  @Test
  fun `an abandoned attempt with no error name builds a message with no class-name suffix`() {
    setUpContext()
    seedRuntimeStatusSchema()

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-abandoned",
      3_000L,
      CycleOutcome("abandoned", "idle", 0, 0, null),
    )

    val row = readRow() ?: error("expected the singleton row to have been inserted")
    assertEquals("Native sync attempt abandoned at stage 'idle'", row["last_failure_message"])
    assertNull(row["last_error_name"])
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
        "last_trigger_source" to "foreground_service",
        "last_synced_count" to 2,
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
    // Schema deliberately NOT seeded: sync_runtime_status does not exist, so the UPDATE inside
    // writeRow throws "no such table" -- record() must swallow it, not propagate it.

    SyncEngineRuntimeStatus.record(
      context,
      "cycle-missing-table",
      6_000L,
      CycleOutcome("closed", "closed", 1, 1, null),
    )

    assertTrue("record() must return normally even when the write itself fails", true)
  }
}
