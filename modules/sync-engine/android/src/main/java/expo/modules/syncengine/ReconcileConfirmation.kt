package expo.modules.syncengine

/**
 * Confirmation pass over the claimed backlog, ported from `getConfirmedOperationIds` +
 * `isOperationConfirmed` (`reconcile-confirmation.helpers.ts`): an `applied_operations` entry
 * matching `anime_id` + `operation` always wins; otherwise the pulled `bridge_changes`
 * themselves are the only evidence — every field the row sent must show up in the change's
 * `changed_fields` or already match its (raw wire) snapshot. A payload with no fields carries
 * nothing to evidence, so it can never be confirmed by inference.
 */
object ReconcileConfirmation {

  /** Returns the ids of every backlog row the bridge's response confirms as applied. */
  fun getConfirmedOperationIds(
    backlog: List<BacklogRow>,
    parsed: ParsedReconcileResponse,
  ): List<Long> {
    val confirmed = mutableListOf<Long>()
    for (row in backlog) {
      if (isOperationConfirmed(row, parsed)) {
        confirmed.add(row.id)
      }
    }
    return confirmed
  }

  private fun isOperationConfirmed(row: BacklogRow, parsed: ParsedReconcileResponse): Boolean {
    val applied = parsed.appliedOperations.firstOrNull {
      it.animeId == row.animeId && it.operation == row.operation
    }
    if (applied != null) {
      return applied.applied
    }

    val payload = ReconcileRequestBody.normalizePayload(row.operation, row.payload)
    if (payload.length() == 0) {
      return false
    }

    return parsed.bridgeChanges.any { change ->
      if (change.recordId != row.animeId || change.changeType == "delete") {
        return@any false
      }
      val snapshot = change.snapshot
      payload.keys().asSequence().all { field ->
        change.changedFields.contains(field) ||
          (snapshot != null && snapshot.has(field) && !snapshot.isNull(field) &&
            jsStrictEquals(snapshot.get(field), payload.get(field)))
      }
    }
  }

  /**
   * Mirrors JavaScript's `===` for the value types org.json can produce: numbers compare by
   * value, strings and booleans by equality, and every object/array by identity (i.e. never
   * equal to a parsed copy), so a structural coincidence cannot fabricate confirmation.
   *
   * The `else` branch is `false`, not `a === b` (T3, sync-core-test-assurance; proven
   * unreachable, not just simplified): [a] is always `snapshot.get(field)` and [b] is always
   * `payload.get(field)` (see [isOperationConfirmed]) -- one value from the response's
   * `bridge_changes[].snapshot`, the other from a freshly re-parsed `operation_log.payload`
   * string. Two independently parsed `org.json` object/array values are never the same
   * instance, so `a === b` could only ever evaluate `true` here for a caller this private
   * function does not have; hardcoding `false` states the doc comment's own intent ("never
   * equal to a parsed copy") directly instead of leaving an identity check whose `true` side is
   * dead.
   */
  private fun jsStrictEquals(a: Any?, b: Any?): Boolean = when {
    a is Number && b is Number -> a.toDouble() == b.toDouble()
    a is String && b is String -> a == b
    a is Boolean && b is Boolean -> a == b
    else -> false
  }
}
