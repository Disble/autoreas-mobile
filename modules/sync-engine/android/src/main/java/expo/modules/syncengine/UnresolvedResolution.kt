package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.util.Log

private const val TAG = "SyncEngineUnresolved"

/**
 * Automatic resolution of unresolved keys (ADR 009 R-16b), mirroring
 * `resolveSupersededOperations` (`unresolved-supersede.helpers.ts`): every event is an absolute
 * `update`, so a later local edit the bridge confirmed carries its anime past each edit given up
 * before it. Those given-up rows (`dead_letter`, `conflict_exhausted`, queued before the confirmed
 * row) are deleted in the transaction that confirms the later row, and every resolution is logged
 * with its key, its rows and its reason (L18: a deterministic resolution is explained, never hidden).
 *
 * The log is written inside the caller's transaction: the response applier has no post-commit
 * seam. A rollback after it (a lease loss while claiming the chain successors) would leave a log
 * line for a resolution that did not land; the rows are then resolved again by the next confirmation.
 */
internal object UnresolvedResolution {
  /** Resolves every key a row in [confirmed] supersedes. [confirmed] holds only rows this claim confirmed. */
  fun resolveSupersededGivenUpRows(appDb: SQLiteDatabase, confirmed: List<BacklogRow>) {
    for (row in confirmed) {
      val givenUp = appDb.rawQuery(
        "SELECT id, status, unresolved_reason FROM operation_log WHERE anime_id = ? AND id < ? " +
          "AND status IN ('dead_letter', 'conflict_exhausted') ORDER BY id",
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
        "DELETE FROM operation_log WHERE anime_id = ? AND id < ? AND status IN ('dead_letter', 'conflict_exhausted')",
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
}
