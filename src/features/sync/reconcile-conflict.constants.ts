/**
 * Attempts a NON-PROGRESSING `conflict` may accumulate before the operation is terminalised
 * (design.md Decision 6). Bounds a LOSING RACE. A conflict whose token ADVANCES resets this
 * counter to 0 instead of incrementing it (spec
 * Requirement "Conflict Re-Bases..."), because progress is not a losing attempt.
 */
export const CONFLICT_ATTEMPT_CAP = 3;

/** The closed vocabulary member meaning the bridge does not support this operation at all. */
export const REASON_UNSUPPORTED_OPERATION = 'unsupported_operation';
/** The closed vocabulary member meaning the write lost an optimistic-concurrency race. */
export const REASON_CONFLICT = 'conflict';
