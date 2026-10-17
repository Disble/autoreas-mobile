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
  fun aConflictAfterFetchingAMissingTokenReBasesOnTheBridgeToken() {
    // No stored token: the row is sent on the fetched token 3 (ADR 009 R-3), and the conflict's
    // token 5 is newer than that base, so the row is re-based and its count reset.
    val after = runConflictCycle(storedToken = null, attemptCount = 1, conflict = conflictWithToken(5), fetchedToken = 3)

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

  @Test
  fun theClassifierTreatsAnUnknownStoredTokenAsProgress() {
    // Fetch-first (ADR 009 R-3) means a cycle never sends without a stored token, so only a direct
    // call reaches the null case; the rule stays total over its input and mirrors the JS one.
    val entry = AppliedOperationEntry("anime-conflict", "update", applied = false, modifiedAt = 5, reason = "conflict")

    assertEquals(RejectedOperationOutcome.Conflict(5, 0, "pending"), classifyRejectedOperation(entry, null, 2))
  }

  private fun conflictWithToken(token: Long): String =
    """{"anime_id":"anime-conflict","operation":"update","applied":false,"reason":"conflict","modified_at":$token}"""

  /**
   * Runs one real cycle whose bridge rejects the only queued row with [conflict]; with no
   * [storedToken], the bridge first answers the fetch-first read with [fetchedToken].
   */
  private fun runConflictCycle(storedToken: Long?, attemptCount: Long, conflict: String, fetchedToken: Long? = null): RowState {
    SyncEngineTestDatabase().use { fixture ->
      val response = SyncEngineTestHttpServer.Response(200, """{"status":"accepted","applied_operations":[$conflict],"last_changelog_id":1}""")
      val fetched = fetchedToken?.let {
        SyncEngineTestHttpServer.Response(200, """{"id":"anime-conflict","modified_at":$it}""")
      }
      SyncEngineTestHttpServer.scripted(listOfNotNull(fetched, response)).use { server ->
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
