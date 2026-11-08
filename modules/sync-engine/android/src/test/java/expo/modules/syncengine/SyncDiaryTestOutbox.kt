package expo.modules.syncengine

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import expo.modules.foregroundsyncticker.SyncDiaryRuntime
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * The app's real telemetry database beside the app database (`filesDir/SQLite/`), provisioned the
 * way the JS store provisions its outbox, with [SyncDiaryRuntime] made synchronous and pinned to
 * [processName], so a test reads every diary record right after the call that made it. The
 * foreground-sync-ticker module keeps its own copy of this fixture: test sources are not shared
 * across Gradle modules. [close] restores the runtime and deletes the file.
 */
internal class SyncDiaryTestOutbox(
  context: Context,
  processName: String = "com.example.app:sync",
) : AutoCloseable {
  val file: File = File(File(context.filesDir, "SQLite"), "autoreas-telemetry.db")

  init {
    // A record an earlier test left queued on the async executor would land in THIS test's
    // file (Robolectric resolves a stale context's filesDir to the current test's directory).
    drainPendingRecords()
    SyncDiaryRuntime.resetForTest()
    SyncDiaryRuntime.executor = Executor { it.run() }
    SyncDiaryRuntime.processNameReader = { processName }
    SyncDiaryRuntime.exitReader = { emptyList() }
    file.parentFile?.mkdirs()
    SQLiteDatabase.openOrCreateDatabase(file, null).use { database ->
      database.execSQL(
        "CREATE TABLE IF NOT EXISTS sync_diagnostics_outbox (" +
          "cycle_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL)",
      )
    }
  }

  /** Every stored row as `cycle_id` to its parsed body, oldest first. */
  fun rows(): List<Pair<String, JSONObject>> =
    SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
      database.rawQuery("SELECT cycle_id, payload FROM sync_diagnostics_outbox ORDER BY created_at, rowid", null)
        .use { cursor ->
          buildList { while (cursor.moveToNext()) add(cursor.getString(0) to JSONObject(cursor.getString(1))) }
        }
    }

  /** Every stored `runtime_transition` as `process_name/subject/transition`, oldest first. */
  fun transitions(): List<String> =
    rows().map { it.second }.filter { it.getString("kind") == "runtime_transition" }.map { body ->
      "${body.getString("process_name")}/${body.getString("subject")}/${body.getString("transition")}"
    }

  private fun drainPendingRecords() {
    val drained = CountDownLatch(1)
    val queued = runCatching { SyncDiaryRuntime.executor.execute { drained.countDown() } }.isSuccess
    if (queued) drained.await(5, TimeUnit.SECONDS)
  }

  override fun close() {
    SyncDiaryRuntime.resetForTest()
    SQLiteDatabase.deleteDatabase(file)
  }
}
