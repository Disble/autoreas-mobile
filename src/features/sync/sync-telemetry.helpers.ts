import { SYNC_CYCLE_ERROR_CAUSE_PATTERNS } from './sync-telemetry.constants';
import type { SyncCycleErrorCause } from './sync-telemetry.types';

/**
 * Maps a raw failure message to a canonical cause symbol, so the message itself never travels.
 *
 * This closes a gap the class name cannot: a closed native handle and lock contention both
 * surface as `LocalWriteError` with a null code at stage `begin`, yet they need different
 * fixes. The distinguishing evidence is in the message, and the message carries database paths,
 * SQL, and bound values. Classifying here means the decision-grade signal crosses the wire
 * while the text that carries it does not.
 *
 * Returns `unknown` -- never the input -- for anything unrecognized.
 */
function classifySyncCycleErrorCause(
  rawMessage: string | null | undefined,
): SyncCycleErrorCause | null {
  if (rawMessage === null || rawMessage === undefined) {
    return null;
  }

  for (const [pattern, cause] of SYNC_CYCLE_ERROR_CAUSE_PATTERNS) {
    if (pattern.test(rawMessage)) {
      return cause;
    }
  }

  return 'unknown';
}

/**
 * Derives the canonical cause from a thrown value, for call sites that hold an error rather than
 * a persisted message.
 *
 * Exists so emission sites do not each re-implement "pull the message out, then classify it" --
 * a duplication where one site eventually forwards the raw message by accident and turns a
 * privacy boundary into a leak. A non-Error throw yields `null` rather than being stringified,
 * because `String(value)` on an arbitrary object is exactly the kind of free text this contract
 * exists to keep off the wire.
 */
export function causeFromError(error: unknown): SyncCycleErrorCause | null {
  return classifySyncCycleErrorCause(error instanceof Error ? error.message : null);
}
