package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineCycleTest {
  @Test
  fun successfulCyclePersistsFencedConfirmation() {
    SyncEngineTestDatabase().use { fixture ->
      val response = """{"applied_operations":[{"anime_id":"anime-k6","operation":"update","applied":true,"modified_at":14}],"last_changelog_id":25}"""
      SyncEngineTestHttpServer(200, response).use { server ->
        val operationCreatedAt = insertCycleInput(fixture, server.port)
        val states = mutableListOf<String>()
        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", "cycle-k6-success", states::add)

        assertEquals(CycleOutcome("closed", "closed", 1, 1, null), outcome)
        assertEquals("POST", server.request.method)
        assertEquals("/api/sync/reconcile", server.request.path)
        assertEquals("Bearer token-k6", server.request.headers["authorization"])
        assertTrue(server.request.headers["content-type"].orEmpty().startsWith("application/json"))
        val body = JSONObject(server.request.body)
        assertEquals("device-k6", body.getString("device_id"))
        assertEquals(20L, body.getLong("last_changelog_id"))
        val operation = body.getJSONArray("pending_operations").getJSONObject(0)
        assertEquals("anime-k6", operation.getString("anime_id"))
        assertEquals("update", operation.getString("operation"))
        assertEquals(2, operation.getJSONObject("payload").getInt("status"))
        assertEquals(operationCreatedAt, operation.getLong("created_at"))
        assertEquals("cycle-k6-success", body.getJSONObject("client_telemetry").getString("cycle_id"))

        assertEquals(listOf("checked", "claimed", "sent", "applied", "closed"), states)
        assertEquals("synced", fixture.operationStatuses().single().second)
        assertEquals(25L, fixture.appDatabase.rawQuery(
          "SELECT last_changelog_id FROM bridge_config WHERE id = 1",
          null,
        ).use { cursor ->
          assertTrue(cursor.moveToFirst())
          cursor.getLong(0)
        })
        assertEquals(
          listOf("checked", "claimed", "sent", "applied", "closed"),
          journalStates(fixture.journalDirectory, "cycle-k6-success"),
        )
        assertEquals(0, fixture.appDatabase.rawQuery(
          "SELECT COUNT(*) FROM sync_cycle_lock WHERE id = 1",
          null,
        ).use { cursor ->
          assertTrue(cursor.moveToFirst())
          cursor.getInt(0)
        })
      }
    }
  }

  private fun insertCycleInput(fixture: SyncEngineTestDatabase, port: Int): Long {
    fixture.appDatabase.execSQL(
      "INSERT INTO bridge_config " +
        "(id, device_id, ip, port, token, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)",
      arrayOf<Any>("device-k6", "127.0.0.1", port.toString(), "token-k6", 20L),
    )
    fixture.appDatabase.execSQL(
      "INSERT INTO animes (_id, bridge_modified_at) VALUES (?, ?)",
      arrayOf<Any>("anime-k6", 7L),
    )
    val createdAt = System.currentTimeMillis()
    fixture.appDatabase.execSQL(
      "INSERT INTO operation_log " +
        "(id, anime_id, operation, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      arrayOf<Any>(41L, "anime-k6", "update", "{\"status\":2}", "pending", createdAt),
    )
    return createdAt
  }

  private fun journalStates(directory: File, cycleId: String): List<String> =
    readJournalColumn(directory, cycleId, "to_state")

  private fun readJournalColumn(directory: File, cycleId: String, column: String): List<String> =
    SQLiteDatabase.openDatabase(
      File(directory, "sync-journal.db").path,
      null,
      SQLiteDatabase.OPEN_READONLY,
    ).use { database ->
      database.rawQuery(
        "SELECT $column FROM journal WHERE cycle_id = ? ORDER BY id",
        arrayOf(cycleId),
      ).use { cursor ->
        buildList {
          while (cursor.moveToNext()) add(cursor.getString(0))
        }
      }
    }
}
