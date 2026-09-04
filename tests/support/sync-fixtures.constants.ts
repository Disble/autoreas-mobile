/**
 * Monotonic counter giving every defaulted fixture row a distinct identity. Held in an object
 * because module-level mutable state cannot live in a function body and still persist across
 * calls, and two defaulted rows must be able to coexist in the same table.
 */
export const FIXTURE_SEQUENCE = { value: 0 };

/** Base epoch used for fixture timestamps, keeping generated values stable and readable. */
export const FIXTURE_EPOCH_MS = 1_700_000_000_000;
