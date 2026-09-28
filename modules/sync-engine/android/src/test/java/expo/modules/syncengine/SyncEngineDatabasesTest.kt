package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.SQLiteMode
import java.io.File

/**
 * Dedicated tests for `SyncEngineDatabases.kt`'s file-level functions (T3,
 * sync-core-test-assurance): before this file, they were exercised only indirectly through
 * [SyncCycleLeaseTest], [SyncEngineCycleTest] and friends. Uses a bespoke minimal schema
 * (never [SyncEngineTestDatabase], see [ownershipDb] below) so the `sync_cycle_lock.fence`
 * column can be left nullable -- matching the REAL production schema
 * (`startup.constants.ts`'s `CREATE TABLE IF NOT EXISTS sync_cycle_lock (... fence TEXT)`, no
 * `NOT NULL`) -- to reach the one branch a `NOT NULL` fixture schema could never exercise.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineDatabasesTest {

  // ---- isSyncCycleLeaseOwnedBy / requireLeaseOwnership ----

  @Test
  fun reportsNotOwnedWhenTheLockTableHasNoRow() {
    ownershipDb().use { db ->
      assertFalse(isSyncCycleLeaseOwnedBy(db, "native_engine", "fence-1"))
    }
  }

  @Test
  fun reportsNotOwnedWhenTheOwnerDiffers() {
    ownershipDb().use { db ->
      insertLock(db, owner = "someone_else", fence = "fence-1")
      assertFalse(isSyncCycleLeaseOwnedBy(db, "native_engine", "fence-1"))
    }
  }

  @Test
  fun reportsNotOwnedWhenTheFenceDiffers() {
    ownershipDb().use { db ->
      insertLock(db, owner = "native_engine", fence = "fence-1")
      assertFalse(isSyncCycleLeaseOwnedBy(db, "native_engine", "fence-OTHER"))
    }
  }

  @Test
  fun reportsNotOwnedWhenTheStoredFenceIsNull() {
    // Reachable in production: `fence` has no `NOT NULL` (startup.constants.ts), so a row from
    // before the fence column's first claim, or a pre-fence-era migration, stores NULL.
    ownershipDb().use { db ->
      insertLock(db, owner = "native_engine", fence = null)
      assertFalse(isSyncCycleLeaseOwnedBy(db, "native_engine", "fence-1"))
    }
  }

  @Test
  fun reportsOwnedWhenBothOwnerAndFenceMatch() {
    ownershipDb().use { db ->
      insertLock(db, owner = "native_engine", fence = "fence-1")
      assertTrue(isSyncCycleLeaseOwnedBy(db, "native_engine", "fence-1"))
    }
  }

  @Test
  fun reportsNotOwnedInsteadOfThrowingWhenTheLockTableIsMissing() {
    val db = SQLiteDatabase.create(null)
    try {
      assertFalse(isSyncCycleLeaseOwnedBy(db, "native_engine", "fence-1"))
    } finally {
      db.close()
    }
  }

  @Test
  fun requireLeaseOwnershipDoesNotThrowWhenOwned() {
    ownershipDb().use { db ->
      insertLock(db, owner = "native_engine", fence = "fence-1")
      requireLeaseOwnership(db, LeaseFence("native_engine", "fence-1"))
    }
  }

  @Test
  fun requireLeaseOwnershipThrowsLeaseLostWhenNotOwned() {
    ownershipDb().use { db ->
      insertLock(db, owner = "native_engine", fence = "fence-1")
      try {
        requireLeaseOwnership(db, LeaseFence("native_engine", "fence-OTHER"))
        fail("expected LeaseLostException")
      } catch (expected: LeaseLostException) {
        // expected
      }
    }
  }

  // ---- readBridgeConfig / hasCompleteBridgeConnection ----

  @Test
  fun readBridgeConfigReturnsNullWhenThereIsNoRow() {
    bridgeConfigDb().use { db ->
      assertNull(readBridgeConfig(db))
    }
  }

  @Test
  fun readBridgeConfigReadsEveryColumnIncludingANullLastChangelogId() {
    bridgeConfigDb().use { db ->
      db.execSQL(
        "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) " +
          "VALUES (1, 'device-1', '192.168.1.1', '8080', 'tok', NULL)",
      )

      val config = readBridgeConfig(db)

      assertNotNull(config)
      assertEquals(1L, config!!.id)
      assertEquals("device-1", config.deviceId)
      assertEquals("192.168.1.1", config.ip)
      assertEquals("8080", config.port)
      assertEquals("tok", config.token)
      assertNull(config.lastChangelogId)
    }
  }

  @Test
  fun readBridgeConfigReadsAPresentLastChangelogId() {
    bridgeConfigDb().use { db ->
      db.execSQL(
        "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) " +
          "VALUES (1, 'device-1', '192.168.1.1', '8080', 'tok', 42)",
      )

      assertEquals(42L, readBridgeConfig(db)!!.lastChangelogId)
    }
  }

  @Test
  fun readBridgeConfigPicksTheNewestRowByIdWhenSeveralExist() {
    bridgeConfigDb().use { db ->
      db.execSQL(
        "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) " +
          "VALUES (1, 'old', '1.1.1.1', '1', 'old-tok', 1)",
      )
      db.execSQL(
        "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) " +
          "VALUES (2, 'new', '2.2.2.2', '2', 'new-tok', 2)",
      )

      assertEquals("new", readBridgeConfig(db)!!.deviceId)
    }
  }

  @Test
  fun readBridgeConfigReturnsNullInsteadOfThrowingWhenTheTableIsMissing() {
    // Mirrors a fresh install: no schema until the foreground's first open.
    val db = SQLiteDatabase.create(null)
    try {
      assertNull(readBridgeConfig(db))
    } finally {
      db.close()
    }
  }

  @Test
  fun hasCompleteBridgeConnectionIsTrueOnlyWhenAllFourFieldsAreNonBlank() {
    val complete = BridgeConfigRow(1, "device", "ip", "port", "token", null)
    assertTrue(hasCompleteBridgeConnection(complete))
  }

  @Test
  fun hasCompleteBridgeConnectionIsFalseWhenDeviceIdIsMissing() {
    assertFalse(hasCompleteBridgeConnection(BridgeConfigRow(1, null, "ip", "port", "token", null)))
  }

  @Test
  fun hasCompleteBridgeConnectionIsFalseWhenIpIsBlank() {
    assertFalse(hasCompleteBridgeConnection(BridgeConfigRow(1, "device", "  ", "port", "token", null)))
  }

  @Test
  fun hasCompleteBridgeConnectionIsFalseWhenPortIsMissing() {
    assertFalse(hasCompleteBridgeConnection(BridgeConfigRow(1, "device", "ip", null, "token", null)))
  }

  @Test
  fun hasCompleteBridgeConnectionIsFalseWhenTokenIsBlank() {
    assertFalse(hasCompleteBridgeConnection(BridgeConfigRow(1, "device", "ip", "port", "", null)))
  }

  // `isNullOrBlank()` is inlined per call site: each of the 4 fields needs BOTH a null-value
  // and a blank-but-non-null-value case to cover that field's own null-check and blank-check
  // branches (the tests above only exercised one variant per field).
  @Test
  fun hasCompleteBridgeConnectionIsFalseWhenDeviceIdIsBlank() {
    assertFalse(hasCompleteBridgeConnection(BridgeConfigRow(1, " ", "ip", "port", "token", null)))
  }

  @Test
  fun hasCompleteBridgeConnectionIsFalseWhenIpIsMissing() {
    assertFalse(hasCompleteBridgeConnection(BridgeConfigRow(1, "device", null, "port", "token", null)))
  }

  @Test
  fun hasCompleteBridgeConnectionIsFalseWhenPortIsBlank() {
    assertFalse(hasCompleteBridgeConnection(BridgeConfigRow(1, "device", "ip", " ", "token", null)))
  }

  @Test
  fun hasCompleteBridgeConnectionIsFalseWhenTokenIsMissing() {
    assertFalse(hasCompleteBridgeConnection(BridgeConfigRow(1, "device", "ip", "port", null, null)))
  }

  // ---- resolveAppDatabaseFile / openAppDatabase ----

  @Test
  fun resolveAppDatabaseFileMatchesExpoSqliteSLocation() {
    val context = RuntimeEnvironment.getApplication()
    val file = resolveAppDatabaseFile(context)

    assertEquals("autoreas.db", file.name)
    assertEquals("SQLite", file.parentFile!!.name)
    assertEquals(context.filesDir.canonicalPath, file.parentFile!!.parentFile!!.canonicalPath)
  }

  @Test
  fun openAppDatabaseCreatesTheSqliteDirectoryAndAppliesTheBusyTimeoutPragma() {
    val context = RuntimeEnvironment.getApplication()
    val db = openAppDatabase(context)
    try {
      assertTrue(db.isOpen)
      assertTrue(resolveAppDatabaseFile(context).parentFile!!.isDirectory)
      db.rawQuery("PRAGMA busy_timeout", null).use { cursor ->
        assertTrue(cursor.moveToFirst())
        assertEquals(APP_DB_BUSY_TIMEOUT_MS, cursor.getLong(0))
      }
    } finally {
      db.close()
    }
  }

  // ---- resolveAppDatabaseReadiness / readAppDatabaseUserVersion / probeAppDatabaseReadiness ----

  @Test
  fun resolveAppDatabaseReadinessReportsNotProvisionedWhenTheFileDoesNotExist() {
    assertEquals(
      AppDatabaseReadiness.NotProvisioned,
      resolveAppDatabaseReadiness(
        fileExists = false,
        userVersion = null,
        expectedVersion = EXPECTED_SCHEMA_READINESS_VERSION,
      ),
    )
  }

  @Test
  fun resolveAppDatabaseReadinessReportsReadyOnTheExpectedVersion() {
    assertEquals(
      AppDatabaseReadiness.Ready,
      resolveAppDatabaseReadiness(
        fileExists = true,
        userVersion = EXPECTED_SCHEMA_READINESS_VERSION,
        expectedVersion = EXPECTED_SCHEMA_READINESS_VERSION,
      ),
    )
  }

  @Test
  fun resolveAppDatabaseReadinessReportsSchemaNotReadyWhenTheVersionIsUnreadable() {
    assertEquals(
      AppDatabaseReadiness.SchemaNotReady,
      resolveAppDatabaseReadiness(
        fileExists = true,
        userVersion = null,
        expectedVersion = EXPECTED_SCHEMA_READINESS_VERSION,
      ),
    )
  }

  @Test
  fun resolveAppDatabaseReadinessReportsSchemaNotReadyWhenTheVersionIsBehind() {
    assertEquals(
      AppDatabaseReadiness.SchemaNotReady,
      resolveAppDatabaseReadiness(
        fileExists = true,
        userVersion = EXPECTED_SCHEMA_READINESS_VERSION - 1,
        expectedVersion = EXPECTED_SCHEMA_READINESS_VERSION,
      ),
    )
  }

  @Test
  fun resolveAppDatabaseReadinessReportsSchemaNotReadyOnAnAbsurdFutureVersion() {
    // A file stamped by a NEWER install than this build understands is not ready either: exact
    // equality is the only proof this build can trust.
    assertEquals(
      AppDatabaseReadiness.SchemaNotReady,
      resolveAppDatabaseReadiness(
        fileExists = true,
        userVersion = Int.MAX_VALUE,
        expectedVersion = EXPECTED_SCHEMA_READINESS_VERSION,
      ),
    )
  }

  @Test
  fun readAppDatabaseUserVersionReadsTheStampedValue() {
    val context = RuntimeEnvironment.getApplication()
    val db = openAppDatabase(context)
    try {
      db.execSQL("PRAGMA user_version = 42")
    } finally {
      db.close()
    }

    assertEquals(42, readAppDatabaseUserVersion(resolveAppDatabaseFile(context)))
  }

  @Test
  fun readAppDatabaseUserVersionReturnsNullInsteadOfThrowingWhenTheFileIsMissing() {
    val context = RuntimeEnvironment.getApplication()
    assertNull(readAppDatabaseUserVersion(resolveAppDatabaseFile(context)))
  }

  @Test
  fun readAppDatabaseUserVersionReturnsNullInsteadOfThrowingWhenTheFileIsNotADatabase() {
    val context = RuntimeEnvironment.getApplication()
    val file = File(context.filesDir, "not-a-database.db")
    file.writeText("this file is not an SQLite database")

    assertNull(readAppDatabaseUserVersion(file))
  }

  @Test
  fun probeAppDatabaseReadinessReportsNotProvisionedWithoutCreatingTheFile() {
    val context = RuntimeEnvironment.getApplication()

    assertEquals(AppDatabaseReadiness.NotProvisioned, probeAppDatabaseReadiness(context))
    assertFalse(
      "the probe must never create the database file",
      resolveAppDatabaseFile(context).exists(),
    )
  }

  @Test
  fun probeAppDatabaseReadinessReportsReadyOnAStampedFile() {
    val context = RuntimeEnvironment.getApplication()
    val db = openAppDatabase(context)
    try {
      db.execSQL("PRAGMA user_version = $EXPECTED_SCHEMA_READINESS_VERSION")
    } finally {
      db.close()
    }

    assertEquals(AppDatabaseReadiness.Ready, probeAppDatabaseReadiness(context))
  }

  @Test
  fun probeAppDatabaseReadinessReportsSchemaNotReadyOnAStaleStamp() {
    val context = RuntimeEnvironment.getApplication()
    val db = openAppDatabase(context)
    try {
      db.execSQL("PRAGMA user_version = ${EXPECTED_SCHEMA_READINESS_VERSION - 1}")
    } finally {
      db.close()
    }

    assertEquals(AppDatabaseReadiness.SchemaNotReady, probeAppDatabaseReadiness(context))
  }

  // ---- deleteAppDatabaseAndSidecars ----

  /**
   * Seeds a real database plus every sidecar `SQLiteDatabase.deleteDatabase` owns, so the test
   * pins the WHOLE deletion unit and not just the main file -- the exact defect (`deleteDatabaseAsync`
   * unlinks `autoreas.db` only) leaves all of them behind.
   */
  @Test
  fun deleteAppDatabaseAndSidecarsRemovesTheDatabaseAndEverySidecar() {
    val context = RuntimeEnvironment.getApplication()
    val databaseFile = resolveAppDatabaseFile(context)
    // A real framework-created database, not a hand-written text file, so the fixture matches
    // what production actually leaves on disk.
    openAppDatabase(context).close()
    val sidecars = sidecarSuffixes.map { suffix -> File(databaseFile.path + suffix) }
    sidecars.forEach { sidecar -> sidecar.writeText("seeded sidecar") }

    assertTrue("the database fixture must exist before deleting", databaseFile.exists())
    sidecars.forEach { sidecar -> assertTrue(sidecar.name, sidecar.exists()) }

    assertTrue(deleteAppDatabaseAndSidecars(context))

    assertFalse("the main database file must be gone", databaseFile.exists())
    sidecars.forEach { sidecar -> assertFalse(sidecar.name, sidecar.exists()) }
  }

  /**
   * The "already deleted" case: nothing to remove at all, so the API must answer `false` and throw
   * nothing. This is what makes a resumed reset safe -- the JS adapter tolerates this answer
   * instead of treating it as a failure.
   */
  @Test
  fun deleteAppDatabaseAndSidecarsAnswersFalseWhenNothingIsLeftToDelete() {
    val context = RuntimeEnvironment.getApplication()

    assertFalse("the database fixture must be absent", resolveAppDatabaseFile(context).exists())
    assertFalse(deleteAppDatabaseAndSidecars(context))
    // A repeat call on a fully clean directory is equally harmless rather than an error.
    assertFalse(deleteAppDatabaseAndSidecars(context))
  }

  /**
   * The orphan case a main-file-only delete produces: no `autoreas.db`, but a `-wal`/`-shm` pair
   * left beside it. Those orphans are the corruption class this unit removes -- the stale WAL can
   * be applied to the freshly created database -- so the deletion must still take them.
   */
  @Test
  fun deleteAppDatabaseAndSidecarsRemovesOrphanedSidecarsWhenTheMainFileIsGone() {
    val context = RuntimeEnvironment.getApplication()
    val databaseFile = resolveAppDatabaseFile(context)
    // `openAppDatabase` is what creates `filesDir/SQLite/`; this test skips it, so the directory
    // the sidecars must live in is created explicitly.
    databaseFile.parentFile!!.mkdirs()
    val orphanedSidecars = listOf(File(databaseFile.path + "-wal"), File(databaseFile.path + "-shm"))
    orphanedSidecars.forEach { sidecar -> sidecar.writeText("orphaned sidecar") }

    assertFalse("the database fixture must be absent", databaseFile.exists())

    assertTrue(deleteAppDatabaseAndSidecars(context))

    assertFalse("the main database file must stay absent", databaseFile.exists())
    orphanedSidecars.forEach { sidecar -> assertFalse(sidecar.name, sidecar.exists()) }
  }

  // ---- inImmediateTransaction ----

  @Test
  fun inImmediateTransactionCommitsAndReturnsTheBlockResult() {
    ownershipDb().use { db ->
      db.execSQL("CREATE TABLE t (v INTEGER)")
      val result = inImmediateTransaction(db) {
        db.execSQL("INSERT INTO t (v) VALUES (1)")
        "block-result"
      }

      assertEquals("block-result", result)
      db.rawQuery("SELECT COUNT(*) FROM t", null).use { cursor ->
        cursor.moveToFirst()
        assertEquals(1L, cursor.getLong(0))
      }
    }
  }

  @Test
  fun inImmediateTransactionRollsBackAndRethrowsWhenTheBlockThrows() {
    ownershipDb().use { db ->
      db.execSQL("CREATE TABLE t (v INTEGER)")

      try {
        inImmediateTransaction(db) {
          db.execSQL("INSERT INTO t (v) VALUES (1)")
          throw IllegalStateException("boom")
        }
        fail("expected the block's exception to propagate")
      } catch (expected: IllegalStateException) {
        assertEquals("boom", expected.message)
      }

      db.rawQuery("SELECT COUNT(*) FROM t", null).use { cursor ->
        cursor.moveToFirst()
        assertEquals("insert must have been rolled back", 0L, cursor.getLong(0))
      }
    }
  }

  @Test
  fun inImmediateTransactionNeverMasksTheOriginalFailureWhenTheRollbackItselfFails() {
    // The block closes the connection before throwing, so the catch block's own `ROLLBACK`
    // fails too -- proving the empty `catch (rollbackError)` never replaces the original error.
    val db = SQLiteDatabase.create(null)
    db.execSQL("CREATE TABLE t (v INTEGER)")

    try {
      inImmediateTransaction(db) {
        db.close()
        throw IllegalStateException("original failure")
      }
      fail("expected the original exception to propagate")
    } catch (expected: IllegalStateException) {
      assertEquals("original failure", expected.message)
    }
  }

  /**
   * The sidecar suffixes Android's SQLite deletion API owns and expo-sqlite's `deleteDatabaseAsync`
   * leaves behind: the rollback journal, the WAL mode's `-shm`/`-wal` pair, and one `-mj*` master
   * journal (`-mj` is a PREFIX match in the API, so any suffix works).
   */
  private val sidecarSuffixes = listOf("-journal", "-shm", "-wal", "-mj0")

  /** A minimal `sync_cycle_lock` table with a NULLABLE `fence`, matching production exactly. */
  private fun ownershipDb(): SQLiteDatabase {
    val db = SQLiteDatabase.create(null)
    db.execSQL(
      "CREATE TABLE sync_cycle_lock (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, " +
        "expires_at INTEGER NOT NULL, fence TEXT)",
    )
    return db
  }

  private fun insertLock(db: SQLiteDatabase, owner: String, fence: String?) {
    db.execSQL(
      "INSERT INTO sync_cycle_lock (id, owner, expires_at, fence) VALUES (?, ?, ?, ?)",
      arrayOf<Any?>(ENGINE_LOCK_ROW_ID, owner, System.currentTimeMillis() + 60_000, fence),
    )
  }

  private fun bridgeConfigDb(): SQLiteDatabase {
    val db = SQLiteDatabase.create(null)
    db.execSQL(
      "CREATE TABLE bridge_config (id INTEGER PRIMARY KEY, device_id TEXT, ip TEXT, port TEXT, " +
        "token TEXT, last_changelog_id INTEGER)",
    )
    return db
  }
}
