package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode
import org.robolectric.shadows.ShadowLog

/**
 * Automatic resolution of unresolved keys in the `:sync` process (ADR 009 R-16b, L18), mirroring
 * `tests/behaviour/sync/unresolved-auto-resolution.behaviour.test.ts`: a later edit the bridge
 * confirms removes the edits of its anime given up before it, in the transaction that confirms
 * it, and logs the key, the rows and the reason.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineUnresolvedResolutionTest {
  private data class RowState(val id: Long, val animeId: String, val status: String)

  @Before
  fun clearLogs() {
    ShadowLog.clear()
  }

  @Test
  fun aConfirmedLaterEditRemovesTheDeadLetteredRowAndLogsWhy() {
    SyncEngineTestDatabase().use { fixture ->
      val responses = listOf(rejected(""""reason":"unsupported_operation""""), confirmed(14))
      SyncEngineTestHttpServer.scripted(responses).use { server ->
        seed(fixture, server)

        cycle(fixture).run("foreground", "cycle-unresolved-1") {}
        assertEquals(listOf(RowState(1, "anime-1", "dead_letter"), RowState(2, "anime-1", "pending")), rows(fixture))
        cycle(fixture).run("foreground", "cycle-unresolved-2") {}

        assertEquals(listOf(RowState(2, "anime-1", "synced")), rows(fixture))
        assertEquals(
          listOf(
            "resolved automatically: key={kind=anime, animeId=anime-1} reason=superseded by confirmed " +
              "operation 2 rows=[{id=1, status=dead_letter, unresolvedReason=null}]",
          ),
          resolutionLogs(),
        )
      }
    }
  }

  @Test
  fun aConfirmedLaterEditRemovesAConflictExhaustedRowTheSameWay() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(confirmed(14))).use { server ->
        seed(fixture, server)
        fixture.appDatabase.execSQL("UPDATE operation_log SET status = 'conflict_exhausted' WHERE id = 1")

        cycle(fixture).run("foreground", "cycle-unresolved") {}

        assertEquals(listOf(RowState(2, "anime-1", "synced")), rows(fixture))
        assertTrue(resolutionLogs().single().contains("rows=[{id=1, status=conflict_exhausted, unresolvedReason=null}]"))
      }
    }
  }

  @Test
  fun neverResolvesAGivenUpRowQueuedAfterTheConfirmedOneNorOneOfAnotherAnime() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(confirmed(14))).use { server ->
        seed(fixture, server)
        fixture.appDatabase.execSQL("UPDATE operation_log SET status = 'dead_letter' WHERE id = 2")
        fixture.appDatabase.execSQL(
          "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at) " +
            "VALUES (3, 'anime-2', 'update', '{}', 'dead_letter', ?)",
          arrayOf<Any>(System.currentTimeMillis()),
        )

        cycle(fixture).run("foreground", "cycle-unresolved") {}

        assertEquals(
          listOf(RowState(1, "anime-1", "synced"), RowState(2, "anime-1", "dead_letter"), RowState(3, "anime-2", "dead_letter")),
          rows(fixture),
        )
        assertEquals(emptyList<String>(), resolutionLogs())
      }
    }
  }

  @Test
  fun neverResolvesAKeyWhoseConfirmationTheJsRuntimeTookOverMidRequest() {
    SyncEngineTestDatabase().use { fixture ->
      lateinit var takeOver: () -> Unit
      val server = SyncEngineTestHttpServer.scripted(listOf(confirmed(14))) { request ->
        if (request.path == RECONCILE_PATH) takeOver()
      }
      server.use {
        seed(fixture, server)
        fixture.appDatabase.execSQL("UPDATE operation_log SET status = 'dead_letter' WHERE id = 1")
        // The claim on row 2 expired mid-request and JS took the key: it is not ours to resolve.
        takeOver = {
          fixture.appDatabase.execSQL(
            "UPDATE operation_log SET claim_owner = 'js', claimed_at = 1 WHERE id = 2",
          )
        }

        cycle(fixture).run("foreground", "cycle-unresolved") {}

        assertEquals("dead_letter", rows(fixture).first().status)
        assertEquals(emptyList<String>(), resolutionLogs())
      }
    }
  }

  private fun cycle(fixture: SyncEngineTestDatabase) = SyncEngineCycle(fixture.appDatabase, fixture.journal)

  /** A paired bridge, `anime-1` stored at token 7, and two queued `anime-1` rows. */
  private fun seed(fixture: SyncEngineTestDatabase, server: SyncEngineTestHttpServer) {
    fixture.appDatabase.execSQL(
      "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)",
      arrayOf<Any>("device-unresolved", "127.0.0.1", server.port.toString(), "token-unresolved", 0L),
    )
    fixture.appDatabase.execSQL("INSERT INTO animes (_id, bridge_modified_at) VALUES ('anime-1', 7)")
    val createdAt = System.currentTimeMillis()
    for (id in 1L..2L) {
      fixture.appDatabase.execSQL(
        "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at) " +
          "VALUES (?, 'anime-1', 'update', ?, 'pending', ?)",
        arrayOf<Any>(id, PAYLOAD, createdAt + id),
      )
    }
  }

  private fun confirmed(token: Long) = response(
    """{"anime_id":"anime-1","operation":"update","applied":true,"modified_at":$token}""",
  )

  private fun rejected(reasonFields: String) = response(
    """{"anime_id":"anime-1","operation":"update","applied":false,$reasonFields}""",
  )

  private fun response(appliedOperation: String) = SyncEngineTestHttpServer.Response(
    200,
    """{"applied_operations":[$appliedOperation],"last_changelog_id":1}""",
  )

  private fun resolutionLogs(): List<String> = ShadowLog.getLogsForTag("SyncEngineUnresolved").map { it.msg }

  private fun rows(fixture: SyncEngineTestDatabase): List<RowState> = fixture.appDatabase.rawQuery(
    "SELECT id, anime_id, status FROM operation_log ORDER BY id",
    null,
  ).use { cursor ->
    buildList {
      while (cursor.moveToNext()) add(RowState(cursor.getLong(0), cursor.getString(1), cursor.getString(2)))
    }
  }

  private companion object {
    const val RECONCILE_PATH = "/api/sync/reconcile"
    const val PAYLOAD = """{"status":2}"""
  }
}
