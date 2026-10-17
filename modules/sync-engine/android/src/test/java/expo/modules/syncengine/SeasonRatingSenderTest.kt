package expo.modules.syncengine

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * The rating pass on its own (ADR 009 R-5, R-13, R-14; L28): the paths a whole cycle against a
 * loopback bridge cannot reach -- a transport failure on the rating alone, a takeover while the
 * rating is out, the chain budget, and payloads the device never wrote.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SeasonRatingSenderTest {
  @Test
  fun aTransportFailureLeavesTheRatingPendingReleasedAndStillSendsTheNextOne() {
    SyncEngineTestDatabase().use { fixture ->
      val sender = claimedSender(fixture, listOf(row(1, "anime-1"), row(2, "anime-2")))
      var calls = 0

      val result = sender.send(listOf(row(1, "anime-1"), row(2, "anime-2")), Long.MAX_VALUE) {
        calls += 1
        if (calls == 1) throw java.io.IOException("connection refused")
        SyncEngineHttpResponse(204, "")
      }

      assertEquals(2, calls)
      assertEquals(1, result.confirmedCount)
      assertEquals(listOf(1L to "pending", 2L to "synced"), fixture.operationStatuses())
      assertEquals(listOf<String?>(null, null), claimOwners(fixture))
    }
  }

  @Test
  fun aRatingTakenOverWhileItWasOutIsNeitherWrittenNorCounted() {
    SyncEngineTestDatabase().use { fixture ->
      val sender = claimedSender(fixture, listOf(row(1, "anime-1")))

      val result = sender.send(listOf(row(1, "anime-1")), Long.MAX_VALUE) {
        fixture.appDatabase.execSQL("UPDATE operation_log SET claim_owner = 'js' WHERE id = 1")
        SyncEngineHttpResponse(204, "")
      }

      assertEquals(SeasonRatingPassResult(0, emptyList()), result)
      assertEquals(listOf(1L to "processing"), fixture.operationStatuses())
    }
  }

  @Test
  fun pastTheChainBudgetADeliveredRatingClaimsNoSuccessor() {
    SyncEngineTestDatabase().use { fixture ->
      val sender = claimedSender(fixture, listOf(row(1, "anime-1")))
      insertRow(fixture, row(2, "anime-1"), "pending")

      val result = sender.send(listOf(row(1, "anime-1")), chainDeadline = 0L) { SyncEngineHttpResponse(204, "") }

      assertEquals(SeasonRatingPassResult(1, emptyList()), result)
      assertEquals(listOf(1L to "synced", 2L to "pending"), fixture.operationStatuses())
    }
  }

  @Test
  fun withinTheChainBudgetADeliveredRatingClaimsItsKeysNextRow() {
    SyncEngineTestDatabase().use { fixture ->
      val sender = claimedSender(fixture, listOf(row(1, "anime-1")))
      insertRow(fixture, row(2, "anime-1"), "pending")

      val result = sender.send(listOf(row(1, "anime-1")), Long.MAX_VALUE) { SyncEngineHttpResponse(204, "") }

      assertEquals(listOf(2L), result.successors.map { it.id })
      assertEquals(listOf(1L to "synced", 2L to "processing"), fixture.operationStatuses())
    }
  }

  @Test
  fun aBodyCarriesOnlyTheFieldsThePayloadHasAndNeverGuessesTheRest() {
    assertEquals(
      """{"anime_id":"anime-1","grade":4,"rated_at":5}""",
      buildSeasonRatingBody(row(1, "anime-1", """{"seasonId":"s","grade":4,"ratedAt":5,"extra":true}""")).toString(),
    )
    assertEquals("""{"anime_id":"anime-1"}""", buildSeasonRatingBody(row(1, "anime-1", """{"seasonId":"s"}""")).toString())
    assertEquals("""{"anime_id":"anime-1"}""", buildSeasonRatingBody(row(1, "anime-1", "[1,2]")).toString())
    assertEquals("""{"anime_id":"anime-1"}""", buildSeasonRatingBody(row(1, "anime-1", "{not json")).toString())
    // A NULL payload column (a row the device never wrote this way) reads as `{}` too.
    assertEquals("{}", parseSeasonRatingPayload(null).toString())
  }

  @Test
  fun everyStatusHasExactlyOneFate() {
    assertEquals(SeasonRatingFate.Delivered, classifySeasonRatingAnswer(204))
    assertEquals(SeasonRatingFate.GivenUp("auth_repair"), classifySeasonRatingAnswer(401))
    assertEquals(SeasonRatingFate.GivenUp("not_found"), classifySeasonRatingAnswer(404))
    assertEquals(SeasonRatingFate.GivenUp("conflict"), classifySeasonRatingAnswer(409))
    assertEquals(SeasonRatingFate.GivenUp("rejected"), classifySeasonRatingAnswer(400))
    assertEquals(SeasonRatingFate.GivenUp("rejected"), classifySeasonRatingAnswer(499))
    // Only a 204 is a delivery, like JS: any other 2xx, a 3xx or a 5xx is retried.
    for (code in listOf(200, 302, 500, 503)) assertEquals("$code", SeasonRatingFate.Pending, classifySeasonRatingAnswer(code))
  }

  /** Seeds [held] as `processing` under a live native claim and a held lease; answers a sender bound to both. */
  private fun claimedSender(fixture: SyncEngineTestDatabase, held: List<BacklogRow>): SeasonRatingSender {
    val lease = SyncCycleLease(fixture.appDatabase)
    assertTrue(lease.claim("cycle-rating-sender"))
    val fence = lease.leaseFence!!
    val claim = OutboxClaim(NATIVE_OUTBOX_CLAIM_OWNER, System.currentTimeMillis())
    for (row in held) {
      insertRow(fixture, row, "processing")
      fixture.appDatabase.execSQL(
        "UPDATE operation_log SET claim_owner = ?, claimed_at = ? WHERE id = ?",
        arrayOf<Any>(claim.owner, claim.claimedAt, row.id),
      )
    }
    val writer = HeldRowWriter(fixture.appDatabase, { fence }, { claim })
    return SeasonRatingSender(fixture.appDatabase, writer, { fence }, { claim }, System::currentTimeMillis)
  }

  private fun insertRow(fixture: SyncEngineTestDatabase, row: BacklogRow, status: String) {
    fixture.appDatabase.execSQL(
      "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      arrayOf<Any>(row.id, row.animeId, row.operation, row.payload, status, row.createdAt),
    )
  }

  private fun claimOwners(fixture: SyncEngineTestDatabase): List<String?> = fixture.appDatabase.rawQuery(
    "SELECT claim_owner FROM operation_log ORDER BY id",
    null,
  ).use { cursor -> buildList { while (cursor.moveToNext()) add(if (cursor.isNull(0)) null else cursor.getString(0)) } }

  private fun row(id: Long, animeId: String, payload: String = PAYLOAD) = BacklogRow(
    id = id,
    animeId = animeId,
    operation = SEASON_RATING_OPERATION,
    payload = payload,
    status = "pending",
    createdAt = 1_000L + id,
    conflictAttemptCount = 0,
  )

  private companion object {
    val PAYLOAD = JSONObject("""{"seasonId":"season-1","grade":5,"ratedAt":1700000000000}""").toString()
  }
}
