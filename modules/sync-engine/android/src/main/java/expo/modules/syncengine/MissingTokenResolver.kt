package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.util.Log
import org.json.JSONException
import org.json.JSONObject

private const val TAG = "MissingTokenResolver"

/** Fetch-first gave a key up because the bridge has no such anime; mirrors `UNRESOLVED_REASON`. */
internal const val UNRESOLVED_BRIDGE_NOT_FOUND = "bridge_404"

/** Fetch-first gave a key up because the bridge returned the anime with no token. */
internal const val UNRESOLVED_TOKEN_MISSING = "token_missing"

/** What fetching one anime with no stored token decided (ADR 009 R-3); mirrors `MissingTokenOutcome`. */
internal sealed interface MissingTokenOutcome {
  /** Send on the token the bridge returned. */
  data class Token(val token: Long) : MissingTokenOutcome

  /** The bridge could not be asked: the key stays pending. */
  data object Unreachable : MissingTokenOutcome

  /** The key is given up with [reason]. */
  data class Unresolved(val reason: String) : MissingTokenOutcome
}

/**
 * Asks the bridge for one anime whose token is missing, mirroring `fetchMissingTokenOutcome`: a
 * transport failure ([fetch] throws) or any status other than 2xx/404 keeps the key pending; a 404
 * and an anime with no token give it up, the latter logged; a token lets the key be sent on it.
 */
internal fun fetchMissingTokenOutcome(
  animeId: String,
  fetch: (String) -> SyncEngineHttpResponse,
): MissingTokenOutcome {
  val response = try {
    fetch(animeId)
  } catch (error: Throwable) {
    return MissingTokenOutcome.Unreachable
  }

  if (response.code == 404) return MissingTokenOutcome.Unresolved(UNRESOLVED_BRIDGE_NOT_FOUND)
  if (response.code !in 200..299) return MissingTokenOutcome.Unreachable

  val token = readFetchedToken(response.body)
  if (token == null) {
    Log.w(TAG, "$UNRESOLVED_TOKEN_MISSING: the bridge returned $animeId with no token")
    return MissingTokenOutcome.Unresolved(UNRESOLVED_TOKEN_MISSING)
  }
  return MissingTokenOutcome.Token(token)
}

/** Reads the integer `modified_at` of a fetched `MobileAnime`, or `null` when it carries none. */
private fun readFetchedToken(body: String?): Long? = try {
  when (val value = JSONObject(body.orEmpty()).opt("modified_at")) {
    is Int -> value.toLong()
    is Long -> value
    else -> null
  }
} catch (error: JSONException) {
  null
}

/**
 * The claim holder's fetch-first step in the `:sync` process (ADR 009 R-3), mirroring
 * `resolveMissingTokens`: a held row whose anime has no stored token is never sent without a base.
 * Each such anime is fetched once, outside any transaction; the outcomes are written in one fenced
 * transaction, the tokens are added to the caller's map, and only sendable rows are returned.
 */
internal class MissingTokenResolver(
  private val appDb: SQLiteDatabase,
  private val heldRows: HeldRowWriter,
  private val fence: () -> LeaseFence,
) {
  fun resolve(
    round: List<BacklogRow>,
    tokensByAnimeId: MutableMap<String, Long?>,
    fetch: (String) -> SyncEngineHttpResponse,
  ): List<BacklogRow> {
    val missing = round.map { it.animeId }.distinct().filter { tokensByAnimeId[it] == null }
    if (missing.isEmpty()) return round

    val outcomes = missing.associateWith { fetchMissingTokenOutcome(it, fetch) }
    // The fetches ran outside any transaction, so the app may have unpaired or the JS runtime
    // taken a key over meanwhile (ADR 009 R-13): only rows this claim still holds are sent.
    val stillHeld = inImmediateTransaction(appDb) {
      requireLeaseOwnership(appDb, fence())
      for ((animeId, outcome) in outcomes) {
        val heldIds = round.filter { it.animeId == animeId }.map { it.id }
        when (outcome) {
          is MissingTokenOutcome.Token -> heldRows.storeMissingToken(animeId, outcome.token)
          MissingTokenOutcome.Unreachable -> heldRows.updateOperationStatus(heldIds, "pending")
          is MissingTokenOutcome.Unresolved -> heldRows.giveKeyUp(animeId, heldIds, outcome.reason)
        }
      }
      heldRows.heldOperationIds(round.map { it.id })
    }

    for ((animeId, outcome) in outcomes) {
      if (outcome is MissingTokenOutcome.Token) tokensByAnimeId[animeId] = outcome.token
    }
    return round.filter { it.id in stillHeld }
  }
}
