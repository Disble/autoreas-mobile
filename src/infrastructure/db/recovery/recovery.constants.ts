import { DATABASE_NAME } from '../client/client.constants';

/**
 * Names the one database file a recovery reset is allowed to destroy.
 *
 * Re-exported from the client constants rather than duplicated, so a rename of the application
 * database cannot leave the reset boundary pointing at a stale name. The orchestrator passes this
 * value -- and nothing else -- to its injected deletion port; that port deletes through the
 * SQLite/Android API, which is also what removes the `-wal`/`-shm` sidecars. This module never
 * builds a file path and never removes a file by hand.
 */
export const RESET_TARGET_DATABASE_NAME = DATABASE_NAME;

/** Names the only reason code that authorizes destroying the application database. */
export const RESET_INTENT_REASON_CONFIRMED_CORRUPTION = 'confirmed_corruption';

/**
 * Closes the vocabulary of reason codes a durable reset intent may carry.
 *
 * Only confirmed physical corruption ever authorizes destruction, so this list holds exactly one
 * member by design. It exists so the persisted record is validated against a named vocabulary
 * instead of an inline literal, and so the persisted record stays a reason code plus a timestamp
 * with nowhere for personal data to live.
 */
export const RESET_INTENT_REASONS = [RESET_INTENT_REASON_CONFIRMED_CORRUPTION] as const;

/**
 * Names the sibling database files a reset must never touch.
 *
 * `autoreas-telemetry.db` holds diagnostics and `sync-journal.db` holds the sync engine's own
 * bookkeeping. Both are separate files from the application database, both must survive a reset,
 * and neither is ever passed to the deletion port. Kept here as executable evidence for the guard
 * asserting `RESET_TARGET_DATABASE_NAME` stays outside this set.
 */
export const RESET_PROTECTED_DATABASE_NAMES = ['autoreas-telemetry.db', 'sync-journal.db'] as const;
