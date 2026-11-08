package expo.modules.foregroundsyncticker

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * The app's real telemetry database (`filesDir/SQLite/autoreas-telemetry.db`, the file
 * [syncDiaryFor] writes), provisioned the way the JS store provisions its outbox, with
 * [SyncDiaryRuntime] made synchronous and pinned to [processName] so a test can read every record
 * right after the call that made it. Every read first moves what the main process queued in the
 * inbox, as the `:sync` process would ([drainInbox]). [close] restores the runtime and deletes both
 * files.
 */
internal class SyncDiaryTestOutbox(
  private val context: Context,
  processName: String = "com.example.app",
) : AutoCloseable {
  val file: File = resolveSyncDiaryTelemetryFile(context.filesDir)

  /** The main process's inbox beside [file]. */
  val inboxFile: File = File(file.parentFile, SYNC_DIARY_INBOX_DATABASE_NAME)

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

  /** Every stored body, oldest first. */
  fun payloads(): List<JSONObject> {
    drainInbox()
    return undrainedPayloads()
  }

  /** Every stored body, oldest first, without moving the inbox first. */
  fun undrainedPayloads(): List<JSONObject> =
    SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
      database.rawQuery("SELECT payload FROM sync_diagnostics_outbox ORDER BY created_at, rowid", null).use { cursor ->
        buildList { while (cursor.moveToNext()) add(JSONObject(cursor.getString(0))) }
      }
    }

  /** Every stored `runtime_transition` as `process_name/subject/transition[/reason]`, oldest first. */
  fun transitions(): List<String> =
    payloads().filter { it.getString("kind") == "runtime_transition" }.map { body ->
      listOfNotNull(
        body.getString("process_name"),
        body.getString("subject"),
        body.getString("transition"),
        body.optString("reason").takeIf { it.isNotEmpty() },
      ).joinToString("/")
    }

  /** Empties the outbox, so a test observes only what follows. */
  fun clear() {
    drainInbox()
    SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READWRITE).use { database ->
      database.execSQL("DELETE FROM sync_diagnostics_outbox")
    }
  }

  /** Moves the inbox into the outbox as the `:sync` process does, answering how many calls moved. */
  fun drainInbox(): Int = SyncDiary(file, null, isSyncProcess = true).drainInbox()

  private fun drainPendingRecords() {
    val drained = CountDownLatch(1)
    val queued = runCatching { SyncDiaryRuntime.executor.execute { drained.countDown() } }.isSuccess
    if (queued) drained.await(5, TimeUnit.SECONDS)
  }

  override fun close() {
    SyncDiaryRuntime.resetForTest()
    SQLiteDatabase.deleteDatabase(file)
    SQLiteDatabase.deleteDatabase(inboxFile)
  }
}
