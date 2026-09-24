package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncCycleLeaseTest {
  private lateinit var database: SQLiteDatabase

  @Before
  fun setUp() {
    database = SQLiteDatabase.create(null)
    database.execSQL(
      "CREATE TABLE sync_cycle_lock (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL, fence TEXT NOT NULL)",
    )
  }

  @After
  fun tearDown() {
    database.close()
  }

  @Test
  fun liveClaimExcludesAnotherAttempt() {
    val firstAttempt = SyncCycleLease(database)
    val secondAttempt = SyncCycleLease(database)

    assertTrue(firstAttempt.claim("cycle-first"))
    assertFalse(secondAttempt.claim("cycle-second"))
    assertEquals("cycle-first", readFence())

    firstAttempt.release()
    assertEquals(0, readLeaseRowCount())
  }

  @Test
  fun expiredReclaimReplacesFence() {
    val expiredOwner = SyncCycleLease(database)
    val newOwner = SyncCycleLease(database)

    assertTrue(expiredOwner.claim("cycle-expired"))
    database.execSQL("UPDATE sync_cycle_lock SET expires_at = 0 WHERE id = 1")

    assertTrue(newOwner.claim("cycle-reclaimed"))
    assertNotEquals("cycle-expired", readFence())
    assertEquals("cycle-reclaimed", readFence())
  }

  @Test
  fun sameAttemptCanRenewItsUnexpiredLeaseWithTheSameFence() {
    val attempt = SyncCycleLease(database)

    assertTrue(attempt.claim("cycle-same"))
    assertTrue(attempt.claim("cycle-same"))
    assertEquals("cycle-same", readFence())
    requireLeaseOwnership(database, attempt.leaseFence!!)
  }

  @Test
  fun liveJavaScriptOwnerExcludesNativeClaim() {
    database.execSQL(
      "INSERT INTO sync_cycle_lock (id, owner, expires_at, fence) " +
        "VALUES (1, 'js_cycle', ?, 'cycle-js')",
      arrayOf(System.currentTimeMillis() + ENGINE_LEASE_MS),
    )
    val nativeAttempt = SyncCycleLease(database)

    assertFalse(nativeAttempt.claim("cycle-native"))
    assertEquals("cycle-js", readFence())
  }

  @Test
  fun reclaimedLeaseRejectsOldOwnerReleaseAndProductionOwnershipCheck() {
    val oldOwner = SyncCycleLease(database)
    val currentOwner = SyncCycleLease(database)

    assertTrue(oldOwner.claim("cycle-old"))
    database.execSQL("UPDATE sync_cycle_lock SET expires_at = 0 WHERE id = 1")
    assertTrue(currentOwner.claim("cycle-current"))

    oldOwner.release()
    assertEquals("cycle-current", readFence())
    try {
      requireLeaseOwnership(database, oldOwner.leaseFence!!)
      throw AssertionError("Reclaimed lease must reject the old owner/fence pair")
    } catch (expected: LeaseLostException) {
      // The production ownership check rejects the reclaimed attempt.
    }
    requireLeaseOwnership(database, currentOwner.leaseFence!!)
  }

  @Test
  fun currentOwnerPassesProductionOwnershipCheckAndCanReleaseLease() {
    val currentOwner = SyncCycleLease(database)

    assertTrue(currentOwner.claim("cycle-current"))
    requireLeaseOwnership(database, currentOwner.leaseFence!!)

    currentOwner.release()
    assertEquals(0, readLeaseRowCount())
  }

  private fun readFence(): String? = database.rawQuery(
    "SELECT fence FROM sync_cycle_lock WHERE id = 1",
    null,
  ).use { cursor ->
    if (cursor.moveToFirst()) cursor.getString(0) else null
  }

  private fun readLeaseRowCount(): Int = database.rawQuery(
    "SELECT COUNT(*) FROM sync_cycle_lock",
    null,
  ).use { cursor ->
    cursor.moveToFirst()
    cursor.getInt(0)
  }

}
