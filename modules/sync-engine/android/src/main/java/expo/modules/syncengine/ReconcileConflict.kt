package expo.modules.syncengine

/** Mirrors `CONFLICT_ATTEMPT_CAP`: the third non-advancing conflict in a row exhausts the row. */
const val CONFLICT_ATTEMPT_CAP = 3L

/** Mirrors `REASON_UNSUPPORTED_OPERATION`: terminal on the first response, never retried. */
const val UNSUPPORTED_OPERATION_REASON = "unsupported_operation"

/** Mirrors `REASON_CONFLICT`. */
private const val CONFLICT_REASON = "conflict"

/** What one rejected (`applied: false`) operation turns into (ADR 009 R-15). */
sealed interface RejectedOperationOutcome {
  /** `unsupported_operation`: the bridge can never apply it. */
  data object DeadLetter : RejectedOperationOutcome

  /**
   * A conflict that carries the bridge's token: the anime re-bases on [bridgeModifiedAt], and
   * the row takes [status] with [attemptCount].
   */
  data class Conflict(
    val bridgeModifiedAt: Long,
    val attemptCount: Long,
    val status: String,
  ) : RejectedOperationOutcome

  /**
   * No safe action: a conflict without a token (a contract violation) or a reason this build
   * does not know. Guessing either way is wrong, so the row only goes back to `pending`.
   */
  data object StaysPending : RejectedOperationOutcome
}

/**
 * Classifies one rejected `applied_operations` entry exactly like the JS
 * `classifyRejectedOperation`: a token different from [storedToken] (the base this attempt sent)
 * is progress and resets the count to 0; the same token increments it, and reaching
 * [CONFLICT_ATTEMPT_CAP] makes the row `conflict_exhausted`.
 */
fun classifyRejectedOperation(
  entry: AppliedOperationEntry,
  storedToken: Long?,
  currentAttemptCount: Long,
): RejectedOperationOutcome {
  if (entry.reason == UNSUPPORTED_OPERATION_REASON) return RejectedOperationOutcome.DeadLetter
  if (entry.reason != CONFLICT_REASON) return RejectedOperationOutcome.StaysPending
  val bridgeModifiedAt = entry.modifiedAt ?: return RejectedOperationOutcome.StaysPending
  val tokenAdvanced = bridgeModifiedAt != storedToken
  val attemptCount = if (tokenAdvanced) 0 else currentAttemptCount + 1
  val status = if (attemptCount >= CONFLICT_ATTEMPT_CAP) "conflict_exhausted" else "pending"
  return RejectedOperationOutcome.Conflict(bridgeModifiedAt, attemptCount, status)
}
