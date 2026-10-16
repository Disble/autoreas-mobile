package expo.modules.syncengine

/** The status that rejects the pairing, never a message (ADR 009 R-5); mirrors `RECONCILE_UNAUTHORIZED_STATUS`. */
internal const val RECONCILE_UNAUTHORIZED_STATUS = 401

/** What one reconcile exchange did with the rows it sent. */
internal sealed interface RoundResult {
  /** The response was applied: [confirmedCount] held confirmations, [successors] claimed, [cursor] reached. */
  data class Applied(val confirmedCount: Int, val successors: List<BacklogRow>, val cursor: Long) : RoundResult

  /**
   * The bridge rejected a message (ADR 009 R-5): a whole-request 4xx other than 401. Nothing is
   * written yet; [sent] are the rows the request carried, still held.
   */
  data class Rejected(val code: Int, val sent: List<BacklogRow>) : RoundResult

  /**
   * The exchange failed and the attempt ends: its rows already took their fate and the journal
   * already names the failure. [confirmedCount] counts the confirmations made before it.
   */
  data class Failed(val errorName: String, val confirmedCount: Int = 0) : RoundResult
}

/** What [isolateMessages] needs from the cycle that runs it. */
internal interface MessageIsolationPort {
  /** Whether this claim still holds [row]: a key taken over meanwhile is not sent again. */
  fun isHeld(row: BacklogRow): Boolean

  /** Sends [row] alone on [cursor], without the telemetry piggyback. */
  fun send(row: BacklogRow, cursor: Long): RoundResult

  /** Dead-letters [row], the message the bridge rejected, and releases it. */
  fun deadLetter(row: BacklogRow)

  /** Releases [rows] to `pending`; never throws. */
  fun release(rows: List<BacklogRow>)

  /** Ends the attempt when no message got through; [rejection] is the last one. */
  fun noneDelivered(rejection: RoundResult.Rejected): RoundResult.Failed
}

/**
 * Re-sends a rejected round one message per request (ADR 009 R-5), mirroring the JS
 * `sendOneMessagePerRequest`: a 4xx then lands on the one message that caused it, which is
 * dead-lettered and its key stops, while every other key is confirmed and chained as usual. Only
 * rows this claim still holds go out, each on the cursor the previous one reached.
 *
 * Any other failure on the way ends it: the failing message already took that failure's fate,
 * and every unsent row and every successor already chained is released to `pending`. When no
 * message got through, [MessageIsolationPort.noneDelivered] ends the attempt, so a round nobody
 * accepted still fails.
 */
internal fun isolateMessages(rejection: RoundResult.Rejected, cursor: Long, port: MessageIsolationPort): RoundResult {
  var reached = cursor
  var confirmed = 0
  val successors = mutableListOf<BacklogRow>()
  var lastRejection = rejection
  var delivered = false
  var unsent = rejection.sent

  try {
    while (unsent.isNotEmpty()) {
      val row = unsent.first()
      unsent = unsent.drop(1)
      if (!port.isHeld(row)) continue

      when (val result = port.send(row, reached)) {
        is RoundResult.Applied -> {
          delivered = true
          confirmed += result.confirmedCount
          successors += result.successors
          reached = result.cursor
        }
        is RoundResult.Rejected -> {
          port.deadLetter(row)
          lastRejection = result
        }
        is RoundResult.Failed -> {
          port.release(unsent + successors)
          return result.copy(confirmedCount = confirmed + result.confirmedCount)
        }
      }
    }
  } catch (error: Throwable) {
    port.release(unsent + successors)
    throw error
  }

  return if (delivered) RoundResult.Applied(confirmed, successors, reached) else port.noneDelivered(lastRejection)
}
