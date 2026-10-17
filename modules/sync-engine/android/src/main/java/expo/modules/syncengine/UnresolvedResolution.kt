package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.util.Log

private const val TAG = "SyncEngineUnresolved"

/**
 * Automatic resolution of unresolved keys (ADR 009 R-16b), mirroring `unresolved-supersede.helpers.ts`.
 * Every event carries absolute values, so a later event the bridge confirmed carries its key past
 * each event of the SAME kind given up before it (L28): an anime `update` never carries a grade,
 * and a rating never carries episodes. So:
 * - a confirmed `update` resolves the anime's given-up `update` rows (`dead_letter`,
 *   `conflict_exhausted`) queued before it;
 * - a delivered rating resolves the given-up ratings of the same anime AND season queued before it.
 * The given-up rows are deleted in the transaction that confirms the later row, and every
 * resolution is logged with its key, its rows and its reason (L18: a deterministic resolution is
 * explained, never hidden).
 *
 * The log is written inside the caller's transaction: neither caller has a post-commit seam. A
 * rollback after it would leave a log line for a resolution that did not land; the rows are then
 * resolved again by the next confirmation.
 */
internal object UnresolvedResolution {
  /** Resolves every anime key a row in [confirmed] supersedes. [confirmed] holds only rows this claim confirmed. */
  fun resolveSupersededGivenUpRows(appDb: SQLiteDatabase, confirmed: List<BacklogRow>) {
    for (row in confirmed) {
      val givenUp = appDb.rawQuery(
        "SELECT id, status, unresolved_reason FROM operation_log WHERE anime_id = ? AND id < ? " +
          "AND operation = '$ANIME_UPDATE_OPERATION' AND status IN ('dead_letter', 'conflict_exhausted') ORDER BY id",
        arrayOf(row.animeId, row.id.toString()),
      ).use { cursor ->
        buildList {
          while (cursor.moveToNext()) {
            add("{id=${cursor.getLong(0)}, status=${cursor.getString(1)}, unresolvedReason=${cursor.getString(2)}}")
          }
        }
      }
      if (givenUp.isEmpty()) continue

      appDb.compileStatement(
        "DELETE FROM operation_log WHERE anime_id = ? AND id < ? AND operation = '$ANIME_UPDATE_OPERATION' " +
          "AND status IN ('dead_letter', 'conflict_exhausted')",
      ).run {
        bindString(1, row.animeId)
        bindLong(2, row.id)
        executeUpdateDelete()
      }
      Log.i(
        TAG,
        "resolved automatically: key={kind=anime, animeId=${row.animeId}} " +
          "reason=superseded by confirmed operation ${row.id} rows=$givenUp",
      )
    }
  }

  /**
   * Resolves the rating key a delivered rating [confirmed] supersedes: the given-up ratings of the
   * same anime and season, queued before it. The season lives in the payload, read here rather
   * than in SQL so no JSON1 support is assumed.
   */
  fun resolveSupersededRatings(appDb: SQLiteDatabase, confirmed: BacklogRow) {
    val seasonId = parseSeasonRatingPayload(confirmed.payload).opt("seasonId")
    val givenUp = appDb.rawQuery(
      "SELECT id, payload, unresolved_reason FROM operation_log WHERE anime_id = ? AND id < ? " +
        "AND operation = '$SEASON_RATING_OPERATION' AND status = 'dead_letter' ORDER BY id",
      arrayOf(confirmed.animeId, confirmed.id.toString()),
    ).use { cursor ->
      buildList {
        while (cursor.moveToNext()) {
          if (parseSeasonRatingPayload(cursor.getString(1)).opt("seasonId") == seasonId) {
            add(cursor.getLong(0) to cursor.getString(2))
          }
        }
      }
    }
    if (givenUp.isEmpty()) return

    appDb.execSQL(
      "DELETE FROM operation_log WHERE id IN (${givenUp.joinToString(", ") { "?" }})",
      givenUp.map { it.first }.toTypedArray(),
    )
    Log.i(
      TAG,
      "resolved automatically: key={kind=season_rating, seasonId=$seasonId, animeId=${confirmed.animeId}} " +
        "reason=superseded by confirmed rating ${confirmed.id} " +
        "rows=${givenUp.map { "{id=${it.first}, unresolvedReason=${it.second}}" }}",
    )
  }
}
