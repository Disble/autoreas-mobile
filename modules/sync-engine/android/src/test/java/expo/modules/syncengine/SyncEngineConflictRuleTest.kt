package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * The conflict rule in the `:sync` process (ADR 009 R-15), mirroring the JS
 * `classifyRejectedOperation`: every conflict re-bases on the bridge's token, the attempt count
 * resets when the token advanced and increments when it did not, and the third non-advancing
 * conflict in a row makes the row `conflict_exhausted`.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineConflictRuleTest {
  private data class RowState(val status: String, val attemptCount: Long, val token: Long?)

  @Test
  fun aConflictWithAnAdvancedTokenReBasesAndResetsTheAttemptCount() {
    val after = runConflictCycle(storedToken = 7, attemptCount = 2, conflict = conflictWithToken(9))

    assertEquals(RowState("pending", 0, 9), after)
  }

  @Test
  fun aConflictRepeatingTheSameTokenCountsOneMoreAttempt() {
    val after = runConflictCycle(storedToken = 7, attemptCount = 0, conflict = conflictWithToken(7))

    assertEquals(RowState("pending", 1, 7), after)
  }

  @Test
  fun theThirdConflictInARowWithoutTheTokenAdvancingExhaustsTheRow() {
    val after = runConflictCycle(storedToken = 7, attemptCount = 2, conflict = conflictWithToken(7))

    assertEquals(RowState("conflict_exhausted", 3, 7), after)
  }

  @Test
  fun aConflictFromAnAnimeWithNoStoredTokenReBasesOnTheBridgeToken() {
    val after = runConflictCycle(storedToken = null, attemptCount = 1, conflict = conflictWithToken(5))

    assertEquals(RowState("pending", 0, 5), after)
  }

  @Test
  fun aConflictWithoutATokenStaysPendingWithoutTouchingTokenOrCount() {
    val after = runConflictCycle(
      storedToken = 7,
      attemptCount = 1,
      conflict = """{"anime_id":"anime-conflict","operation":"update","applied":false,"reason":"conflict"}""",
    )

    assertEquals(RowState("pending", 1, 7), after)
  }

  @Test
  fun anUnsupportedOperationIsStillDeadLetteredOnTheFirstResponse() {
    val after = runConflictCycle(
      storedToken = 7,
      attemptCount = 0,
      conflict = """{"anime_id":"anime-conflict","operation":"update","applied":false,"reason":"unsupported_operation"}""",
    )

    assertEquals(RowState("dead_letter", 0, 7), after)
  }

  private fun conflictWithToken(token: Long): String =
    """{"anime_id":"anime-conflict","operation":"update","applied":false,"reason":"conflict","modified_at":$token}"""

  /** Runs one real cycle whose bridge rejects the only queued row with [conflict]. */
  private fun runConflictCycle(storedToken: Long?, attemptCount: Long, conflict: String): RowState {
    SyncEngineTestDatabase().use { fixture ->
      val response = """{"applied_operations":[$conflict],"last_changelog_id":1}"""
      SyncEngineTestHttpServer(200, response).use { server ->
        fixture.appDatabase.execSQL(
          "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)",
          arrayOf<Any>("device-conflict", "127.0.0.1", server.port.toString(), "token-conflict", 0L),
        )
        fixture.appDatabase.execSQL(
          "INSERT INTO animes (_id, bridge_modified_at) VALUES (?, ?)",
          arrayOf<Any?>("anime-conflict", storedToken),
        )
        fixture.appDatabase.execSQL(
          "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at, conflict_attempt_count) " +
            "VALUES (1, 'anime-conflict', 'update', ?, 'pending', ?, ?)",
          arrayOf<Any>(PAYLOAD, System.currentTimeMillis(), attemptCount),
        )

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal).run("foreground", "cycle-conflict") {}

        assertEquals("closed", outcome.outcome)
        return readState(fixture)
      }
    }
  }

  private fun readState(fixture: SyncEngineTestDatabase): RowState = fixture.appDatabase.rawQuery(
    "SELECT o.status, o.conflict_attempt_count, a.bridge_modified_at FROM operation_log o " +
      "JOIN animes a ON a._id = o.anime_id WHERE o.id = 1",
    null,
  ).use { cursor ->
    check(cursor.moveToFirst())
    RowState(cursor.getString(0), cursor.getLong(1), if (cursor.isNull(2)) null else cursor.getLong(2))
  }

  private companion object {
    const val PAYLOAD = """{"status":2}"""
  }
}
