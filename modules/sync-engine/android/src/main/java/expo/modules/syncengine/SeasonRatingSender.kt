package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.util.Log
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

private const val TAG = "SeasonRatingSender"

/** The `operation_log.operation` of an anime edit, sent through reconcile (ADR 009 R-3). */
internal const val ANIME_UPDATE_OPERATION = "update"

/** The `operation_log.operation` of a season rating, sent through its own endpoint (L20, L28). */
internal const val SEASON_RATING_OPERATION = "season_rating"

/** The bridge route that records a mobile season rating; mirrors `BRIDGE_API_PATHS.activeSeasonRating`. */
internal const val SEASON_RATING_PATH = "/api/seasons/active/ratings"

/** What one rating answer means for its row (ADR 009 R-5); mirrors `resolveSeasonRatingDelivery`. */
internal sealed interface SeasonRatingFate {
  /** The bridge recorded it (204): the row is `synced`. */
  data object Delivered : SeasonRatingFate

  /** The bridge rejected it (4xx): the row is unresolved with [reason]. */
  data class GivenUp(val reason: String) : SeasonRatingFate

  /** Anything else (transport failure, 5xx, another status): the row stays `pending`. */
  data object Pending : SeasonRatingFate
}

/** Classifies one rating answer's status code into its single fate (ADR 009 R-5). */
internal fun classifySeasonRatingAnswer(code: Int): SeasonRatingFate = when {
  code == 204 -> SeasonRatingFate.Delivered
  code == 401 -> SeasonRatingFate.GivenUp("auth_repair")
  code == 404 -> SeasonRatingFate.GivenUp("not_found")
  code == 409 -> SeasonRatingFate.GivenUp("conflict")
  code in 400..499 -> SeasonRatingFate.GivenUp("rejected")
  else -> SeasonRatingFate.Pending
}

/**
 * Parses a stored rating payload (`{"seasonId","grade","ratedAt"}`). The column is free-form TEXT,
 * so anything that is not a JSON object reads as `{}`, like `parseOperationPayload`.
 */
internal fun parseSeasonRatingPayload(payload: String?): JSONObject = try {
  JSONTokener(payload.orEmpty()).nextValue() as? JSONObject ?: JSONObject()
} catch (error: JSONException) {
  JSONObject()
}

/**
 * Builds the wire body `{anime_id, grade, rated_at, season_id}` for one rating row. A field the
 * payload does not carry is omitted, never guessed: the bridge then rejects the message (422), which
 * gives the row its 4xx fate like any other rejected message. The queued season travels as
 * `season_id`, so a rating for a season the bridge has since replaced is refused (404) instead of
 * landing in the new one.
 */
internal fun buildSeasonRatingBody(row: BacklogRow): JSONObject {
  val payload = parseSeasonRatingPayload(row.payload)
  return JSONObject().apply {
    put("anime_id", row.animeId)
    payload.opt("grade")?.let { put("grade", it) }
    payload.opt("ratedAt")?.let { put("rated_at", it) }
    payload.opt("seasonId")?.let { put("season_id", it) }
  }
}

/** What one rating pass did: the ratings it confirmed and the next row of each confirmed key. */
internal data class SeasonRatingPassResult(val confirmedCount: Int, val successors: List<BacklogRow>)

/**
 * Sends the season ratings of one round (ADR 009 R-14, L28), one message per request and oldest
 * first, mirroring the JS rating pass. Before each send the holder re-checks its claim (R-13), so
 * a key the JS runtime took over is never posted. Each answer is settled in its own fenced
 * transaction, compare-and-set on the claim:
 * - 204: the row is `synced`, the given-up ratings of the same anime and season it supersedes are
 *   resolved (R-16b), and the key's next row is claimed while the chain budget lasts;
 * - a 4xx: the row is unresolved with its reason, and its key stops this cycle;
 * - anything else: the row goes back to `pending`, released, and its key stops this cycle.
 *
 * A rating's answer never fails the attempt (I4): every other message is still sent. Neither does
 * a local write failure while settling one: that row is released to `pending` in a separate
 * best-effort write (a resend is a 204 no-op at the bridge) and the pass goes on. Every successor
 * a delivery claims is reported through [onClaimed] as soon as its transaction commits, so the
 * attempt can release it if anything later fails.
 */
internal class SeasonRatingSender(
  private val appDb: SQLiteDatabase,
  private val heldRows: HeldRowWriter,
  private val fence: () -> LeaseFence,
  private val claim: () -> OutboxClaim,
  private val clock: () -> Long,
  private val onClaimed: (List<BacklogRow>) -> Unit,
) {
  fun send(
    ratings: List<BacklogRow>,
    chainDeadline: Long,
    post: (body: String) -> SyncEngineHttpResponse,
  ): SeasonRatingPassResult {
    var confirmed = 0
    val successors = mutableListOf<BacklogRow>()
    for (row in ratings) {
      if (heldRows.heldOperationIds(listOf(row.id)).isEmpty()) continue

      val fate = try {
        classifySeasonRatingAnswer(post(buildSeasonRatingBody(row).toString()).code)
      } catch (error: Throwable) {
        // Transport failure: retryable, never given up.
        SeasonRatingFate.Pending
      }
      val next = settleSafely(row, fate, chainDeadline)
      if (next != null) {
        onClaimed(next)
        confirmed += 1
        successors += next
      }
    }
    return SeasonRatingPassResult(confirmed, successors)
  }

  /**
   * Settles [row], or answers `null` when its local write failed: the failed transaction rolled
   * back, so the row is still held, and it is released to `pending` in a separate write. A lost
   * lease is not a write failure; it still ends the attempt.
   */
  private fun settleSafely(row: BacklogRow, fate: SeasonRatingFate, chainDeadline: Long): List<BacklogRow>? = try {
    settle(row, fate, chainDeadline)
  } catch (error: LeaseLostException) {
    throw error
  } catch (error: Exception) {
    Log.w(TAG, "could not record a rating answer; releasing it to pending", error)
    release(row)
    null
  }

  /**
   * Releases [row] to `pending`, compare-and-set on the claim. Best effort: when this write fails
   * too, the row stays `processing` until its claim expires (60 s, R-13), and the next attempt
   * that claims it re-sends it.
   */
  private fun release(row: BacklogRow) {
    try {
      inImmediateTransaction(appDb) { heldRows.updateOperationStatus(listOf(row.id), "pending") }
    } catch (error: Exception) {
      Log.w(TAG, "could not release a rating; its claim expiry releases it", error)
    }
  }

  /**
   * Writes [row]'s [fate] in one fenced transaction. Answers the successors it claimed when this
   * claim still held [row] and the bridge confirmed it, or `null` when nothing was confirmed here.
   */
  private fun settle(row: BacklogRow, fate: SeasonRatingFate, chainDeadline: Long): List<BacklogRow>? =
    inImmediateTransaction(appDb) {
      requireLeaseOwnership(appDb, fence())
      // Re-read inside the transaction: a key taken over mid-request is not ours to write.
      if (heldRows.heldOperationIds(listOf(row.id)).isEmpty()) return@inImmediateTransaction null

      when (fate) {
        SeasonRatingFate.Delivered -> {
          heldRows.updateOperationStatus(listOf(row.id), "synced")
          UnresolvedResolution.resolveSupersededRatings(appDb, row)
          if (clock() >= chainDeadline) emptyList() else claimChainSuccessors(appDb, claim(), listOf(row.animeId))
        }
        is SeasonRatingFate.GivenUp -> {
          heldRows.giveOperationUp(row.id, fate.reason)
          null
        }
        SeasonRatingFate.Pending -> {
          heldRows.updateOperationStatus(listOf(row.id), "pending")
          null
        }
      }
    }
}
