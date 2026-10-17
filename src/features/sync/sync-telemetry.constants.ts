/**
 * Closed vocabulary for WHY a cycle failed, as opposed to which class threw.
 *
 * The class name alone is not enough to choose a fix: a closed native handle and lock
 * contention both surface as `LocalWriteError` with a null code at stage `begin`. What
 * separates them lives in the error message, and the message can never cross the wire. So the
 * message is classified on the client and only this symbol is transmitted.
 */
export const SYNC_CYCLE_ERROR_CAUSES = [
  'closed_resource',
  'lock_contention',
  'disk_full',
  'io_error',
  'timeout',
  'unreachable',
  'unknown',
] as const;

/**
 * Message patterns mapped to canonical causes. Order matters: the first match wins, so more
 * specific signatures must precede broader ones.
 */
export const SYNC_CYCLE_ERROR_CAUSE_PATTERNS: readonly (readonly [
  RegExp,
  (typeof SYNC_CYCLE_ERROR_CAUSES)[number],
])[] = [
  [/access to closed resource/i, 'closed_resource'],
  [/SQLITE_BUSY|database is locked|SQLITE_LOCKED/i, 'lock_contention'],
  [/SQLITE_FULL|disk (is )?full/i, 'disk_full'],
  [/SQLITE_IOERR|i\/o error/i, 'io_error'],
  [/exceeded \d+ ?ms|timed? ?out/i, 'timeout'],
  [/did not reach|unreachable|network request failed/i, 'unreachable'],
];
