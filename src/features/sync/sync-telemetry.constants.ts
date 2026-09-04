/**
 * Closed set of error classes allowed to cross the wire.
 *
 * This allowlist is a PRIVACY boundary, not a convenience. The bridge stores reconcile request
 * bodies verbatim and unsanitized (headers and response bodies are scrubbed; request bodies are
 * not), they persist at rest, they are copied with backups, and they are readable through MCP.
 * A raw `error.message` on Android carries the database path, SQL fragments, and bound values --
 * and in this app the bound values are anime titles. Anything not on this list collapses to
 * `unknown`, so no free text can ever reach transport through this field.
 */
export const SYNC_CYCLE_ERROR_NAMES = [
  'LocalWriteError',
  'BridgeTimeoutError',
  'BridgeUnreachableError',
  'ReconcileHttpError',
  'SchemaValidationError',
  'unknown',
] as const;

/**
 * Closed set of transaction phases an error may be attributed to.
 *
 * These MIRROR `LocalWriteFailureStage` exactly, plus `unknown`. Keeping them in sync is the
 * whole point: an allowlist that omits a value the runtime actually produces does not filter,
 * it blinds -- the omitted case collapses to `unknown` and the field stops answering anything.
 */
export const SYNC_CYCLE_ERROR_STAGES = [
  'begin',
  'task',
  'commit',
  'rollback',
  'deadline',
  'unknown',
] as const;

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

/**
 * Shape a value must have to be fingerprinted: a bare code identifier.
 *
 * This is a structural barrier, not a convention. Hashing an error MESSAGE would let anyone
 * with a candidate list confirm its contents by dictionary, reintroducing anime titles through
 * the back door. A message, a path, or a title cannot satisfy this pattern; a class name can.
 */
export const SYNC_CYCLE_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

// The cycle-checkpoint vocabulary is NOT redeclared here. It is owned by
// `sync-runtime-status.types.ts` alongside the state machine it describes, and re-exported so
// this module stays the single import site for every transport allowlist. A second hand-written
// copy is exactly how a vocabulary drifts out of sync with the code it claims to describe.
export { SYNC_CYCLE_STAGES } from './sync-runtime-status.constants';

/**
 * Upper bound for the forwarded native error byte -- the natural range of `charCodeAt`, derived
 * from the source type rather than picked.
 *
 * The field is named for what it IS, not what it resembles. `parseSqliteErrcode` returns
 * `charCodeAt(0)` of a control byte parsed out of the native message, so the value is a code
 * point, not a SQLite result code. Calling it `error_code` would have been actively misleading:
 * `SQLITE_BUSY` is 5, so a reader would take a `5` here as lock contention when it only means the
 * control byte was 0x05. The explanatory comment does not travel on the wire; the name does.
 *
 * A bounded integer also cannot express a path, a message, or a user value under any encoding,
 * which makes it a stronger privacy guarantee than any string pattern could be.
 */
export const NATIVE_ERRCODE_BYTE_MAX = 65535;

/**
 * Hard byte budget for the `client_telemetry` field, agreed with team-bridge.
 *
 * Two limits exist upstream and the smaller one fails SILENTLY: `MaxBytesReader` rejects a body
 * over 1 MiB outright, but `MaxCapturedBodyBytes` (64 KiB) merely stops capturing while the
 * reconcile still answers 202. Crossing it would make this telemetry vanish without a trace AND
 * take the reconcile payload capture -- which the team already relies on -- down with it. 4 KiB
 * keeps a wide margin even with a large pending backlog sharing the same body.
 */
export const SYNC_CYCLE_TELEMETRY_MAX_BYTES = 4096;
