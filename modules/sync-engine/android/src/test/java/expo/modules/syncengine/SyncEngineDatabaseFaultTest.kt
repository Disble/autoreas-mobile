package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * The line between a store whose schema is not there yet (tolerated: not owned, no config) and a
 * database that actually failed (propagated, so the cycle reports `failed` naming the fault).
 * The tolerant cases themselves stay pinned where they always were, in [SyncEngineDatabasesTest]
 * and [SyncCycleLeaseTest]; this suite holds the classifier and the real faults.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineDatabaseFaultTest {

  @Test
  fun aMissingTableOrColumnIsAMissingSchema() {
    assertTrue(isMissingSchemaError(compileError("SELECT * FROM sync_cycle_lock")))
    assertTrue(isMissingSchemaError(compileError("SELECT is_sync_telemetry_enabled FROM probe")))
  }

  @Test
  fun anyOtherSqliteFailureIsNotAMissingSchema() {
    assertFalse(isMissingSchemaError(SQLiteException("database is locked (code 5 SQLITE_BUSY)")))
    assertFalse(isMissingSchemaError(SQLiteException()))
  }

  @Test
  fun theOwnershipCheckPropagatesACorruptStoreInsteadOfReportingNotOwned() {
    SyncEngineTestDatabase(appDatabaseIsFile = true).use { fixture ->
      val corrupted = fixture.openCorruptedAppDatabase()

      assertThrows(SQLiteDatabaseCorruptException::class.java) {
        isSyncCycleLeaseOwnedBy(corrupted, ENGINE_LOCK_OWNER, "fence-1")
      }
    }
  }

  @Test
  fun aCorruptStoreOnTheOlderSchemaStillPropagatesFromTheFallbackRead() {
    // The telemetry-switch column is missing (tolerated, the fallback read runs), but the fallback
    // read itself hits the corrupt table page: that second failure must propagate, not read null.
    SyncEngineTestDatabase(appDatabaseIsFile = true).use { fixture ->
      fixture.appDatabase.execSQL("DROP TABLE bridge_config")
      fixture.appDatabase.execSQL(
        "CREATE TABLE bridge_config (id INTEGER PRIMARY KEY, device_id TEXT, ip TEXT, port TEXT, " +
          "token TEXT, last_changelog_id INTEGER)",
      )
      fixture.appDatabase.execSQL("INSERT INTO bridge_config (id, device_id) VALUES (1, 'device-old')")
      val corrupted = fixture.openCorruptedAppDatabase()

      assertThrows(SQLiteDatabaseCorruptException::class.java) { readBridgeConfig(corrupted) }
    }
  }

  /** The exception SQLite itself raises compiling [sql] against an empty in-memory store. */
  private fun compileError(sql: String): SQLiteException {
    val db = SQLiteDatabase.create(null)
    try {
      db.execSQL("CREATE TABLE probe (id INTEGER PRIMARY KEY)")
      return assertThrows(SQLiteException::class.java) { db.rawQuery(sql, null).use { it.moveToFirst() } }
    } finally {
      db.close()
    }
  }
}
