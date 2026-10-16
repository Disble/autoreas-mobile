package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * [isolateMessages] against a scripted port: the edges a cycle-level test cannot reach cheaply
 * (a row taken over before its turn, a local failure mid-isolation). The cycle-level fates are
 * pinned by [SyncEngineMessageIsolationTest].
 */
class MessageIsolationTest {
  private val rowA = row(1, "anime-a")
  private val rowB = row(2, "anime-b")
  private val successor = row(3, "anime-b")

  private class ScriptedPort(
    private val held: Set<Long>,
    private val answers: Map<Long, () -> RoundResult>,
  ) : MessageIsolationPort {
    val sent = mutableListOf<Pair<Long, Long>>()
    val deadLettered = mutableListOf<Long>()
    val released = mutableListOf<List<Long>>()

    override fun isHeld(row: BacklogRow) = row.id in held

    override fun send(row: BacklogRow, cursor: Long): RoundResult {
      sent += row.id to cursor
      return answers.getValue(row.id)()
    }

    override fun deadLetter(row: BacklogRow) {
      deadLettered += row.id
    }

    override fun release(rows: List<BacklogRow>) {
      released += rows.map { it.id }
    }

    override fun noneDelivered(rejection: RoundResult.Rejected) = RoundResult.Failed("none:${rejection.code}")
  }

  @Test
  fun skipsARowNoLongerHeldAndSendsTheNextOneOnTheCursorThePreviousReached() {
    val rowC = row(4, "anime-c")
    val port = ScriptedPort(
      held = setOf(rowB.id, rowC.id),
      answers = mapOf(
        rowB.id to { RoundResult.Applied(1, listOf(successor), 30) },
        rowC.id to { RoundResult.Applied(1, emptyList(), 31) },
      ),
    )

    val result = isolateMessages(RoundResult.Rejected(422, listOf(rowA, rowB, rowC)), 20, port)

    assertEquals(RoundResult.Applied(2, listOf(successor), 31), result)
    assertEquals(listOf(rowB.id to 20L, rowC.id to 30L), port.sent)
  }

  @Test
  fun deadLettersTheRejectedMessageAndEndsThroughNoneDeliveredWhenNothingGotThrough() {
    val port = ScriptedPort(
      held = setOf(rowA.id, rowB.id),
      answers = mapOf(
        rowA.id to { RoundResult.Rejected(400, listOf(rowA)) },
        rowB.id to { RoundResult.Rejected(409, listOf(rowB)) },
      ),
    )

    val result = isolateMessages(RoundResult.Rejected(422, listOf(rowA, rowB)), 20, port)

    assertEquals(RoundResult.Failed("none:409"), result)
    assertEquals(listOf(rowA.id, rowB.id), port.deadLettered)
  }

  @Test
  fun releasesTheUnsentRowsAndTheChainedSuccessorsOnAFailedSendCountingEarlierConfirmations() {
    val rowC = row(4, "anime-c")
    val port = ScriptedPort(
      held = setOf(rowA.id, rowB.id, rowC.id),
      answers = mapOf(
        rowA.id to { RoundResult.Applied(1, listOf(successor), 30) },
        rowB.id to { RoundResult.Failed("ReconcileHttpError") },
      ),
    )

    val result = isolateMessages(RoundResult.Rejected(422, listOf(rowA, rowB, rowC)), 20, port)

    assertEquals(RoundResult.Failed("ReconcileHttpError", confirmedCount = 1), result)
    assertEquals(listOf(listOf(rowC.id, successor.id)), port.released)
  }

  @Test
  fun releasesTheThrowingRowTheUnsentRowsAndTheChainedSuccessorsWhenALocalWriteThrows() {
    val failure = IllegalStateException("disk I/O error")
    val port = ScriptedPort(
      held = setOf(rowA.id, rowB.id),
      answers = mapOf(
        rowA.id to { RoundResult.Applied(1, listOf(successor), 30) },
        rowB.id to { throw failure },
      ),
    )

    val thrown = assertThrows(IllegalStateException::class.java) {
      isolateMessages(RoundResult.Rejected(422, listOf(rowA, rowB)), 20, port)
    }

    assertSame(failure, thrown)
    assertEquals(listOf(listOf(rowB.id, successor.id)), port.released)
  }

  private fun row(id: Long, animeId: String) = BacklogRow(id, animeId, "update", "{}", "processing", id, 0)
}
