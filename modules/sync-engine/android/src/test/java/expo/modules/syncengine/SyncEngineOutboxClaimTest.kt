package expo.modules.syncengine

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * Per-key outbox claims between the two runtimes (ADR 009 R-13), seen from the `:sync` process:
 * a live claim makes the key belong to its holder, an expired one is taken, every status write is
 * compare-and-set on the claim, and recovery resets only expired claims.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineOutboxClaimTest {
  private data class ClaimRow(val status: String, val owner: String?, val claimedAt: Long?)

  @Test
  fun skipsAKeyTheJsRuntimeHoldsWithALiveClaimWithoutTouchingTheRow() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer(200, EMPTY_RESPONSE).use { server ->
        val liveJsClaim = ClaimRow("processing", "js", System.currentTimeMillis() - 10_000)
        insertCycleInput(fixture, server.port, liveJsClaim)

        SyncEngineCycle(fixture.appDatabase, fixture.journal).run("foreground", "cycle-claim-live") {}

        val sent = JSONObject(server.request.body).getJSONArray("pending_operations")
        assertEquals(0, sent.length())
        assertEquals(liveJsClaim, readClaim(fixture))
      }
    }
  }

  @Test
  fun neverSendsANewerRowOfAKeyTheJsRuntimeHolds() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer(200, EMPTY_RESPONSE).use { server ->
        insertCycleInput(fixture, server.port, ClaimRow("processing", "js", System.currentTimeMillis() - 10_000))
        val newerRow = ClaimRow("pending", null, null)
        insertRow(fixture, ROW_ID + 1, "anime-claim", newerRow)

        SyncEngineCycle(fixture.appDatabase, fixture.journal).run("foreground", "cycle-claim-newer") {}

        val sent = JSONObject(server.request.body).getJSONArray("pending_operations")
        assertEquals(0, sent.length())
        assertEquals(newerRow, readClaim(fixture, ROW_ID + 1))
      }
    }
  }

  @Test
  fun takesAKeyWhoseClaimExpiredAfterSixtySecondsAndReleasesItOnceConfirmed() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer(200, CONFIRMING_RESPONSE).use { server ->
        insertCycleInput(fixture, server.port, ClaimRow("processing", "js", System.currentTimeMillis() - 61_000))

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", "cycle-claim-expired") {}

        assertEquals("closed", outcome.outcome)
        val sent = JSONObject(server.request.body).getJSONArray("pending_operations")
        assertEquals("anime-claim", sent.getJSONObject(0).getString("anime_id"))
        assertEquals(ClaimRow("synced", null, null), readClaim(fixture))
      }
    }
  }

  @Test
  fun recordsItsOwnClaimOwnerAndTimeWhileTheRequestIsInFlight() {
    SyncEngineTestDatabase().use { fixture ->
      var inFlight: ClaimRow? = null
      val before = System.currentTimeMillis()
      SyncEngineTestHttpServer(200, CONFIRMING_RESPONSE) { request ->
        if (request.path == RECONCILE_PATH) inFlight = readClaim(fixture)
      }.use { server ->
        insertCycleInput(fixture, server.port, ClaimRow("pending", null, null))

        SyncEngineCycle(fixture.appDatabase, fixture.journal).run("foreground", "cycle-claim-own") {}

        assertEquals("processing", inFlight?.status)
        assertEquals("native", inFlight?.owner)
        assertTrue((inFlight?.claimedAt ?: 0L) >= before)
      }
    }
  }

  @Test
  fun neverRevertsARowTheJsRuntimeConfirmedAfterThisClaimWasLost() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer(200, EMPTY_RESPONSE) { request ->
        if (request.path == RECONCILE_PATH) confirmByJs(fixture)
      }.use { server ->
        insertCycleInput(fixture, server.port, ClaimRow("pending", null, null))

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", "cycle-claim-lost") {}

        // A row that is no longer ours is not a lost lease: the attempt still closes.
        assertEquals("closed", outcome.outcome)
        assertEquals(ClaimRow("synced", null, null), readClaim(fixture))
      }
    }
  }

  @Test
  fun neverRevertsAConfirmedRowWhenItsOwnRequestThenFails() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer(500, """{"error":"boom"}""") { request ->
        if (request.path == RECONCILE_PATH) confirmByJs(fixture)
      }.use { server ->
        insertCycleInput(fixture, server.port, ClaimRow("pending", null, null))

        SyncEngineCycle(fixture.appDatabase, fixture.journal).run("foreground", "cycle-claim-fail") {}

        assertEquals(ClaimRow("synced", null, null), readClaim(fixture))
      }
    }
  }

  @Test
  fun recoveryResetsOnlyExpiredClaims() {
    SyncEngineTestDatabase().use { fixture ->
      val lease = LeaseFence(ENGINE_LOCK_OWNER, "cycle-recovery")
      check(SyncCycleLease(fixture.appDatabase).claim(lease.fence))
      val now = System.currentTimeMillis()
      insertRow(fixture, 1, "anime-live", ClaimRow("processing", "js", now - 10_000))
      insertRow(fixture, 2, "anime-expired", ClaimRow("processing", "js", now - 61_000))
      insertRow(fixture, 3, "anime-legacy", ClaimRow("processing", null, null))

      val result = SyncEngineRecovery(fixture.appDatabase, fixture.journal).sweep("cycle-recovery", lease)

      assertEquals(2, result.processingReturned)
      assertEquals(ClaimRow("processing", "js", now - 10_000), readClaim(fixture, 1))
      assertEquals(ClaimRow("pending", null, null), readClaim(fixture, 2))
      assertEquals(ClaimRow("pending", null, null), readClaim(fixture, 3))
    }
  }

  private fun insertCycleInput(fixture: SyncEngineTestDatabase, port: Int, claim: ClaimRow) {
    fixture.appDatabase.execSQL(
      "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)",
      arrayOf<Any>("device-claim", "127.0.0.1", port.toString(), "token-claim", 0L),
    )
    fixture.appDatabase.execSQL(
      "INSERT INTO animes (_id, bridge_modified_at) VALUES (?, ?)",
      arrayOf<Any>("anime-claim", 7L),
    )
    insertRow(fixture, ROW_ID, "anime-claim", claim)
  }

  private fun insertRow(fixture: SyncEngineTestDatabase, id: Long, animeId: String, claim: ClaimRow) {
    fixture.appDatabase.execSQL(
      "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at, claim_owner, claimed_at) " +
        "VALUES (?, ?, 'update', ?, ?, ?, ?, ?)",
      // A recent `created_at`, so the post-apply prune keeps a `synced` row inside its TTL.
      arrayOf<Any?>(id, animeId, PAYLOAD, claim.status, System.currentTimeMillis(), claim.owner, claim.claimedAt),
    )
  }

  /** What the JS runtime does after taking the key over: it confirms and releases the row. */
  private fun confirmByJs(fixture: SyncEngineTestDatabase) {
    fixture.appDatabase.execSQL(
      "UPDATE operation_log SET status = 'synced', claim_owner = NULL, claimed_at = NULL WHERE id = $ROW_ID",
    )
  }

  private fun readClaim(fixture: SyncEngineTestDatabase, id: Long = ROW_ID): ClaimRow =
    fixture.appDatabase.rawQuery(
      "SELECT status, claim_owner, claimed_at FROM operation_log WHERE id = ?",
      arrayOf(id.toString()),
    ).use { cursor ->
      check(cursor.moveToFirst())
      ClaimRow(
        cursor.getString(0),
        if (cursor.isNull(1)) null else cursor.getString(1),
        if (cursor.isNull(2)) null else cursor.getLong(2),
      )
    }

  private companion object {
    const val ROW_ID = 41L
    const val RECONCILE_PATH = "/api/sync/reconcile"
    const val PAYLOAD = """{"status":2}"""
    const val EMPTY_RESPONSE = """{"status":"accepted","applied_operations":[],"last_changelog_id":1}"""
    const val CONFIRMING_RESPONSE =
      """{"status":"accepted","applied_operations":[{"anime_id":"anime-claim","operation":"update","applied":true,"modified_at":14}],"last_changelog_id":1}"""
  }
}
