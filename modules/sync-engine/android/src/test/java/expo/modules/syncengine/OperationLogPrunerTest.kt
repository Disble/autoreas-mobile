package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * [OperationLogPruner] had NO dedicated test before this file (T3, sync-core-test-assurance):
 * only indirect coverage through [SyncEngineCycleTest]'s end-to-end attempts. Every case here
 * mirrors a behavioural case of its JS twin, `pruneOperationLog`
 * (`operation-log-retention.helpers.ts`), tested in
 * `tests/features/sync/__tests__/operation-log-retention.helpers.test.ts`: TTL first, then
 * max-count, per terminal status, oldest first -- so the two engines prune identically.
 *
 * Retention values (7 days/1000 rows `synced`, 30 days/500 `dead_letter`/`conflict_exhausted`)
 * are `private const val` in `OperationLogPruner.kt` (file-private, invisible even from this same-
 * package test) and are hardcoded here from the class's own doc comment, which names them
 * explicitly.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class OperationLogPrunerTest {

  private val retentionDayMs = 24L * 60L * 60L * 1000L

  @Test
  fun deletesSyncedRowsPastTheSevenDayTtlButKeepsRowsWithinIt() {
    SyncEngineTestDatabase().use { fixture ->
      val lease = claimLease(fixture, "cycle-ttl-synced")
      val now = System.currentTimeMillis()
      insertOperation(fixture, id = 1, status = "synced", createdAt = now - 8 * retentionDayMs)
      insertOperation(fixture, id = 2, status = "synced", createdAt = now - 6 * retentionDayMs)

      OperationLogPruner.pruneSafely(fixture.appDatabase, lease)

      assertEquals(listOf(2L to "synced"), fixture.operationStatuses())
    }
  }

  @Test
  fun deletesDeadLetterRowsPastThe30DayTtlButKeepsRowsWithinIt() {
    SyncEngineTestDatabase().use { fixture ->
      val lease = claimLease(fixture, "cycle-ttl-dead-letter")
      val now = System.currentTimeMillis()
      insertOperation(fixture, id = 1, status = "dead_letter", createdAt = now - 31 * retentionDayMs)
      insertOperation(fixture, id = 2, status = "dead_letter", createdAt = now - 29 * retentionDayMs)

      OperationLogPruner.pruneSafely(fixture.appDatabase, lease)

      assertEquals(listOf(2L to "dead_letter"), fixture.operationStatuses())
    }
  }

  @Test
  fun deletesConflictExhaustedRowsPastThe30DayTtlButKeepsRowsWithinIt() {
    SyncEngineTestDatabase().use { fixture ->
      val lease = claimLease(fixture, "cycle-ttl-conflict-exhausted")
      val now = System.currentTimeMillis()
      insertOperation(
        fixture,
        id = 1,
        status = "conflict_exhausted",
        createdAt = now - 31 * retentionDayMs,
      )
      insertOperation(
        fixture,
        id = 2,
        status = "conflict_exhausted",
        createdAt = now - 29 * retentionDayMs,
      )

      OperationLogPruner.pruneSafely(fixture.appDatabase, lease)

      assertEquals(listOf(2L to "conflict_exhausted"), fixture.operationStatuses())
    }
  }

  @Test
  fun neverTouchesActiveNonTerminalStatusesRegardlessOfAge() {
    SyncEngineTestDatabase().use { fixture ->
      val lease = claimLease(fixture, "cycle-active-untouched")
      val ancient = System.currentTimeMillis() - 3650 * retentionDayMs
      insertOperation(fixture, id = 1, status = "pending", createdAt = ancient)
      insertOperation(fixture, id = 2, status = "processing", createdAt = ancient)

      OperationLogPruner.pruneSafely(fixture.appDatabase, lease)

      assertEquals(
        listOf(1L to "pending", 2L to "processing"),
        fixture.operationStatuses(),
      )
    }
  }

  @Test
  fun enforcesTheSyncedMaxCountOfOneThousandAfterTtlDeletingOldestFirst() {
    SyncEngineTestDatabase().use { fixture ->
      val lease = claimLease(fixture, "cycle-maxcount-synced")
      val now = System.currentTimeMillis()
      // All within the 7-day TTL (createdAt = now + id) so only the max-count pass can prune
      // these; 1002 rows for a 1000 cap means exactly the two oldest (ids 1 and 2) overflow.
      insertOperations(fixture, count = 1002, status = "synced") { id -> now + id }

      OperationLogPruner.pruneSafely(fixture.appDatabase, lease)

      val remaining = fixture.operationStatuses()
      assertEquals(1000, remaining.size)
      assertTrue(remaining.none { (id, _) -> id == 1L || id == 2L })
      assertTrue(remaining.any { (id, _) -> id == 1002L })
    }
  }

  @Test
  fun enforcesTheDeadLetterMaxCountOfFiveHundredAfterTtlDeletingOldestFirst() {
    SyncEngineTestDatabase().use { fixture ->
      val lease = claimLease(fixture, "cycle-maxcount-dead-letter")
      val now = System.currentTimeMillis()
      insertOperations(fixture, count = 503, status = "dead_letter") { id -> now + id }

      OperationLogPruner.pruneSafely(fixture.appDatabase, lease)

      val remaining = fixture.operationStatuses()
      assertEquals(500, remaining.size)
      assertTrue(remaining.none { (id, _) -> id in 1L..3L })
    }
  }

  @Test
  fun enforcesTheConflictExhaustedMaxCountOfFiveHundredAfterTtlDeletingOldestFirst() {
    SyncEngineTestDatabase().use { fixture ->
      val lease = claimLease(fixture, "cycle-maxcount-conflict-exhausted")
      val now = System.currentTimeMillis()
      insertOperations(fixture, count = 501, status = "conflict_exhausted") { id -> now + id }

      OperationLogPruner.pruneSafely(fixture.appDatabase, lease)

      val remaining = fixture.operationStatuses()
      assertEquals(500, remaining.size)
      assertTrue(remaining.none { (id, _) -> id == 1L })
    }
  }

  @Test
  fun requireLeaseOwnershipGuardThrowsBeforeAnyRowIsDeleted() {
    SyncEngineTestDatabase().use { fixture ->
      claimLease(fixture, "cycle-original")
      val now = System.currentTimeMillis()
      insertOperation(fixture, id = 1, status = "synced", createdAt = now - 8 * retentionDayMs)
      // A stale/forged fence that does not name the row currently held: mirrors a reclaim
      // between the caller's last guarded write and this prune (ADR 008 fencing).
      val staleFence = LeaseFence(owner = ENGINE_LOCK_OWNER, fence = "not-the-current-fence")

      try {
        OperationLogPruner.pruneSafely(fixture.appDatabase, staleFence)
        fail("expected LeaseLostException")
      } catch (expected: LeaseLostException) {
        // expected: the fence contract rethrows lease loss, never swallows it.
      }

      // The TTL-eligible row must survive: the ownership check runs BEFORE any delete, as the
      // first statement inside the transaction.
      assertEquals(listOf(1L to "synced"), fixture.operationStatuses())
    }
  }

  @Test
  fun aNonLeaseFailureInsideThePruneIsWarnedAndSwallowedNotThrown() {
    SyncEngineTestDatabase().use { fixture ->
      val lease = claimLease(fixture, "cycle-broken-schema")
      // Drops the table the prune deletes from, AFTER the lease is claimed against
      // sync_cycle_lock: requireLeaseOwnership still succeeds, so the first DELETE inside the
      // transaction throws SQLiteException("no such table"), which pruneSafely's own
      // catch(Throwable) -- never the LeaseLostException branch -- must warn and swallow.
      fixture.appDatabase.execSQL("DROP TABLE operation_log")

      // Must not throw: a prune failure must never fail the attempt (step 9 of the contract).
      OperationLogPruner.pruneSafely(fixture.appDatabase, lease)
    }
  }

  private fun claimLease(fixture: SyncEngineTestDatabase, cycleId: String): LeaseFence {
    val lease = SyncCycleLease(fixture.appDatabase)
    assertTrue("expected lease claim for $cycleId", lease.claim(cycleId))
    return lease.leaseFence!!
  }

  private fun insertOperation(fixture: SyncEngineTestDatabase, id: Long, status: String, createdAt: Long) {
    fixture.appDatabase.execSQL(
      "INSERT INTO operation_log (id, status, created_at) VALUES (?, ?, ?)",
      arrayOf<Any>(id, status, createdAt),
    )
  }

  /** Bulk-inserts [count] rows of [status] (ids 1..count) inside one transaction for speed. */
  private fun insertOperations(
    fixture: SyncEngineTestDatabase,
    count: Int,
    status: String,
    createdAtForId: (Long) -> Long,
  ) {
    fixture.appDatabase.execSQL("BEGIN IMMEDIATE")
    try {
      val statement = fixture.appDatabase.compileStatement(
        "INSERT INTO operation_log (id, status, created_at) VALUES (?, ?, ?)",
      )
      for (id in 1..count) {
        statement.bindLong(1, id.toLong())
        statement.bindString(2, status)
        statement.bindLong(3, createdAtForId(id.toLong()))
        statement.executeInsert()
        statement.clearBindings()
      }
      fixture.appDatabase.execSQL("COMMIT")
    } catch (error: Throwable) {
      fixture.appDatabase.execSQL("ROLLBACK")
      throw error
    }
  }
}
