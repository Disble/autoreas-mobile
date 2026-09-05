/**
 * Attempts a NON-PROGRESSING `conflict` may accumulate before the operation is terminalised
 * (design.md Decision 6). Bounds a LOSING RACE, never SILENCE -- see
 * `STALLED_OPERATION_VISIBILITY_THRESHOLD_MS` for the separate, much larger bound on visibility.
 * A conflict whose token ADVANCES resets this counter to 0 instead of incrementing it (spec
 * Requirement "Conflict Re-Bases..."), because progress is not a losing attempt.
 */
export const CONFLICT_ATTEMPT_CAP = 3;

/**
 * How long (ms) an operation may keep losing a PROGRESSING race -- a `conflict` whose token
 * advances every cycle -- before it is surfaced as stalled. This never terminalises the
 * operation and never touches `CONFLICT_ATTEMPT_CAP` (which counts only NON-progressing
 * conflicts and would never reach this state on its own): the operation keeps retrying, because a
 * token that keeps advancing means optimistic concurrency is working exactly as designed. The
 * bound exists solely so a user edit that never lands is not invisible forever -- deliberately far
 * higher than `CONFLICT_ATTEMPT_CAP`, whose cost is a discarded edit, not a notice (spec
 * Requirement "A Stalled Operation Becomes Visible, Not Terminal").
 */
export const STALLED_OPERATION_VISIBILITY_THRESHOLD_MS = 6 * 60 * 60 * 1000;

/** The closed vocabulary member meaning the bridge does not support this operation at all. */
export const REASON_UNSUPPORTED_OPERATION = 'unsupported_operation';
/** The closed vocabulary member meaning the write lost an optimistic-concurrency race. */
export const REASON_CONFLICT = 'conflict';
