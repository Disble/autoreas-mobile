package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineRecoveryTest {
  @Test
  fun compensatesStaleUnfinishedAttemptAndExcludesCurrentAttempt() {
    SyncEngineTestDatabase().use { fixture ->
      val lease = claimLease(fixture, "cycle-recoverer")
      val staleAt = System.currentTimeMillis() - (ENGINE_LEASE_MS * 2)
      assertTrue(
        fixture.journal.append("cycle-stale", "sent", "claimed", "interrupted", staleAt),
      )
      assertTrue(
        fixture.journal.append("cycle-recoverer", null, "checked", null, System.currentTimeMillis()),
      )
      assertEquals(staleAt, fixture.journal.readLatestTransition("cycle-recoverer")!!.atMs)

      val result = SyncEngineRecovery(fixture.appDatabase, fixture.journal)
        .sweep("cycle-recoverer", lease)

      assertEquals("cycle-stale", result.abandonedCycleId)
      assertFalse(result.leaseLost)
      val latest = fixture.journal.readLatestTransition("cycle-recoverer")!!
      assertEquals("cycle-stale", latest.cycleId)
      assertEquals("abandoned", latest.toState)
    }
  }

  @Test
  fun returnsOrphanedProcessingRowsAndLeavesOtherStatusesAlone() {
    SyncEngineTestDatabase().use { fixture ->
      val lease = claimLease(fixture, "cycle-current")
      fixture.addOperation(1, "processing")
      fixture.addOperation(2, "processing")
      fixture.addOperation(3, "pending")
      fixture.addOperation(4, "dead_letter")

      val result = SyncEngineRecovery(fixture.appDatabase, fixture.journal)
        .sweep("cycle-current", lease)

      assertEquals(2, result.processingReturned)
      assertEquals(
        listOf(1L to "pending", 2L to "pending", 3L to "pending", 4L to "dead_letter"),
        fixture.operationStatuses(),
      )
    }
  }

  @Test
  fun leavesFreshUnfinishedAttemptUnchanged() {
    SyncEngineTestDatabase().use { fixture ->
      val lease = claimLease(fixture, "cycle-current")
      fixture.journal.append(
        "cycle-fresh",
        null,
        "sent",
        null,
        System.currentTimeMillis(),
      )

      val result = SyncEngineRecovery(fixture.appDatabase, fixture.journal)
        .sweep("cycle-current", lease)

      assertEquals(null, result.abandonedCycleId)
      assertEquals("sent", fixture.journal.readLatestTransition("cycle-current")!!.toState)
    }
  }

  @Test
  fun leavesEveryTerminalAttemptUnchanged() {
    listOf("closed", "failed", "abandoned", "not_applicable").forEach { terminalState ->
      SyncEngineTestDatabase().use { fixture ->
        val lease = claimLease(fixture, "cycle-current")
        fixture.journal.append(
          "cycle-terminal",
          "sent",
          terminalState,
          null,
          System.currentTimeMillis() - ENGINE_LEASE_MS - 1,
        )

        val result = SyncEngineRecovery(fixture.appDatabase, fixture.journal)
          .sweep("cycle-current", lease)

        assertEquals(terminalState, fixture.journal.readLatestTransition("cycle-current")!!.toState)
        assertEquals(null, result.abandonedCycleId)
      }
    }
  }

  @Test
  fun reportsLostLeaseWithoutChangingLatestJournalTransitionOrProcessingRows() {
    SyncEngineTestDatabase().use { fixture ->
      val staleLease = claimLease(fixture, "cycle-stale")
      fixture.journal.append("cycle-stale", null, "claimed", null, System.currentTimeMillis())
      val latestBeforeSweep = fixture.journal.readLatestTransition("cycle-inspector")
      fixture.addOperation(1, "processing")
      fixture.appDatabase.execSQL("UPDATE sync_cycle_lock SET expires_at = 0 WHERE id = 1")
      assertTrue(SyncCycleLease(fixture.appDatabase).claim("cycle-successor"))

      val result = SyncEngineRecovery(fixture.appDatabase, fixture.journal)
        .sweep("cycle-stale", staleLease)

      assertTrue(result.leaseLost)
      assertEquals(null, result.abandonedCycleId)
      assertEquals(listOf(1L to "processing"), fixture.operationStatuses())
      assertEquals(latestBeforeSweep, fixture.journal.readLatestTransition("cycle-inspector"))
    }
  }

  private fun claimLease(fixture: SyncEngineTestDatabase, cycleId: String): LeaseFence {
    val lease = SyncCycleLease(fixture.appDatabase)
    assertTrue("expected lease claim for $cycleId", lease.claim(cycleId))
    return lease.leaseFence!!
  }
}
