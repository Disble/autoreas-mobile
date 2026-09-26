package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import java.io.File

/** Name of the JS-owned telemetry database; mirrors `SYNC_CYCLE_CHECKPOINT_DATABASE_NAME`. */
const val SYNC_DIAGNOSTICS_TELEMETRY_DATABASE_NAME = "autoreas-telemetry.db"

/** Lock-wait budget for a diagnostics outbox write; mirrors `SYNC_DIAGNOSTICS_OUTBOX_BUSY_TIMEOUT_MS`. */
const val SYNC_DIAGNOSTICS_OUTBOX_BUSY_TIMEOUT_MS = 250L

/** One stored diagnostics envelope, oldest-first, as the drain reads it. */
data class SyncDiagnosticsOutboxEntry(
  val cycleId: String,
  val payload: String,
  val createdAt: Long,
)

/**
 * Resolves the telemetry database as the SIBLING of the app database file, which is where
 * expo-sqlite puts both (`filesDir/SQLite/`) and therefore where the JS outbox writer put it.
 */
fun resolveTelemetryDatabaseFile(appDatabaseFile: File): File =
  File(appDatabaseFile.parentFile, SYNC_DIAGNOSTICS_TELEMETRY_DATABASE_NAME)

/**
 * The JS-owned candidate query, the `SYNC_DIAGNOSTICS_OUTBOX_SELECT_CANDIDATES_SQL` statement plus
 * one deliberate addition: `CAST(? AS INTEGER)` on the gate comparison.
 *
 * `rawQuery` can only bind TEXT arguments, and SQLite compares a numeric column against a
 * TEXT-bound value by STORAGE CLASS -- every number sorts below every string -- so a gate of 500
 * would satisfy `not_before <= '499'` and the closed gate would never hide a row. The CAST restores
 * the numeric comparison the JS store gets for free from its own typed binding, and the opening
 * value is unchanged.
 */
private const val SELECT_CANDIDATES_SQL =
  "SELECT cycle_id, payload, created_at FROM sync_diagnostics_outbox " +
    "WHERE COALESCE((SELECT not_before FROM sync_diagnostics_outbox_state WHERE id = 1), 0) " +
    "<= CAST(? AS INTEGER) " +
    "ORDER BY created_at ASC, rowid ASC " +
    "LIMIT ?"

/** The JS-owned removal statement, byte-identical to `SYNC_DIAGNOSTICS_OUTBOX_REMOVE_SQL`. */
private const val REMOVE_ENTRY_SQL = "DELETE FROM sync_diagnostics_outbox WHERE cycle_id = ?"

/** The JS-owned gate upsert, byte-identical to `SYNC_DIAGNOSTICS_OUTBOX_STATE_UPSERT_SQL`. */
private const val UPSERT_NOT_BEFORE_SQL =
  "INSERT INTO sync_diagnostics_outbox_state (id, not_before) VALUES (1, ?) " +
    "ON CONFLICT(id) DO UPDATE SET not_before = excluded.not_before"

/**
 * Native reader/writer of the JS-owned diagnostics outbox -- the SAME `autoreas-telemetry.db`
 * `syncDiagnosticsOutboxStore` writes, opened as a second connection. The schema is JS-owned, so
 * this class runs exactly the store's own statements and never its DDL: a database this build
 * finds unprovisioned stays unprovisioned (see [readCandidates]).
 *
 * The connection is opened lazily and only when the file already exists, because
 * `SQLiteDatabase.openDatabase` CREATES a missing file: opening eagerly would make the native
 * engine the author of a database it does not own, on every device whose foreground JS has never
 * queued anything.
 *
 * Every method swallows `SQLiteException` into its own neutral no-op ([readCandidates] `[]`,
 * [remove] `false`, [deferUntil] nothing). Both failure shapes are real on a device: a missing
 * file (nothing has been queued yet) and a file without the outbox tables (provisioned by a JS
 * build that predates them). Neither may become the reason a sync cycle fails, and neither may
 * provoke a write: the drain's contract is "deliver what is there", never "provision what is
 * not".
 */
class SyncEngineDiagnosticsOutbox(private val file: File) : AutoCloseable {
  /** This store's own handle; opened on first use so a missing file is never created. */
  private var database: SQLiteDatabase? = null

  /**
   * Reads up to [limit] candidates whose gate is open at [atTime], oldest-first, using the
   * JS-owned statement's own ordering (`created_at ASC, rowid ASC`).
   *
   * The order is LOAD-BEARING, not cosmetic: eviction sheds the tail so the retained prefix is
   * always the oldest rows, which makes a row in flight unreachable by eviction. That guarantee
   * holds only while this read's order matches the retained-prefix order, so the clause is
   * reproduced verbatim rather than re-derived.
   *
   * The not-before gate is folded into the same SELECT as a sub-select (Decision 6), so the caller
   * has one case to handle: an empty list means "nothing to send OR the gate is shut".
   */
  fun readCandidates(limit: Int, atTime: Long): List<SyncDiagnosticsOutboxEntry> {
    val database = openOrNull() ?: return emptyList()
    return try {
      database.rawQuery(
        SELECT_CANDIDATES_SQL,
        // TEXT bindings, and the gate comparison casts them back: see SELECT_CANDIDATES_SQL.
        arrayOf(atTime.toString(), limit.toString()),
      ).use { cursor ->
        buildList {
          while (cursor.moveToNext()) {
            add(
              SyncDiagnosticsOutboxEntry(
                cycleId = cursor.getString(0),
                payload = cursor.getString(1),
                createdAt = cursor.getLong(2),
              ),
            )
          }
        }
      }
    } catch (error: SQLiteException) {
      emptyList()
    }
  }

  /**
   * Removes one entry by cycle id. JS parity: the store reports a confirmed removal whenever the
   * DELETE did not throw, so a cycle id that is already gone is confirmed too -- nothing is left
   * to deliver for it -- and only a store that cannot be written at all answers `false`.
   */
  fun remove(cycleId: String): Boolean {
    val database = openOrNull() ?: return false
    return try {
      database.execSQL(REMOVE_ENTRY_SQL, arrayOf<Any>(cycleId))
      true
    } catch (error: SQLiteException) {
      false
    }
  }

  /**
   * Persists the singleton not-before gate. Written only when a response carried a usable
   * `Retry-After`, and never cleared (a past timestamp is already open); a transport failure never
   * sets it, since the trigger cadence is the backoff.
   */
  fun deferUntil(notBefore: Long) {
    val database = openOrNull() ?: return
    try {
      database.execSQL(UPSERT_NOT_BEFORE_SQL, arrayOf<Any>(notBefore))
    } catch (error: SQLiteException) {
      // A gate that cannot be persisted costs the next cycle one wasted attempt, never a delivery.
    }
  }

  /** Closes this store's own connection; a no-op when nothing was ever opened. */
  override fun close() {
    val database = this.database ?: return
    this.database = null
    try {
      database.close()
    } catch (error: SQLiteException) {
      // Closing is best-effort: the process is about to lose or reopen the handle anyway.
    }
  }

  /**
   * Opens -- once -- the existing telemetry database in read/write mode, or answers `null` when
   * there is nothing this store may touch. `OPEN_READWRITE` (never `CREATE`) plus the explicit
   * existence check is what keeps the file and its schema JS-owned.
   */
  private fun openOrNull(): SQLiteDatabase? {
    database?.let { open -> if (open.isOpen) return open }
    database = null
    if (!file.exists()) return null
    val opened = try {
      SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READWRITE)
    } catch (error: SQLiteException) {
      return null
    }
    opened.compileStatement("PRAGMA busy_timeout = $SYNC_DIAGNOSTICS_OUTBOX_BUSY_TIMEOUT_MS").execute()
    database = opened
    return opened
  }
}
