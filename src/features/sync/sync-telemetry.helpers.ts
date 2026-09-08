import * as Crypto from 'expo-crypto';
import { toWireDiagnosticEvents } from './sync-diagnostic-events.helpers';
import { isSyncTelemetryEnabled } from './sync-telemetry-preference.helpers';
import type {
  SyncCycleStage,
  SyncRuntimeStatusSnapshot,
} from './sync-runtime-status.types';
import {
  SYNC_CYCLE_ERROR_CAUSE_PATTERNS,
  NATIVE_ERRCODE_BYTE_MAX,
  SYNC_CYCLE_ERROR_NAMES,
  SYNC_CYCLE_ERROR_STAGES,
  SYNC_CYCLE_IDENTIFIER_PATTERN,
  SYNC_CYCLE_STAGES,
  SYNC_CYCLE_TELEMETRY_MAX_BYTES,
} from './sync-telemetry.constants';
import type {
  BuildSyncCycleTelemetryInput,
  PreviousCycleTelemetry,
  SyncCycleErrorCause,
  SyncCycleErrorName,
  SyncCycleErrorStage,
  SyncCycleOutcome,
  SyncCycleTelemetry,
  WireSyncCycleTelemetry,
} from './sync-telemetry.types';

/**
 * Collapses any value outside `allowed` onto `fallback`, preserving an explicit absence as null.
 *
 * This is the single choke point that keeps free text out of transport. The bridge persists
 * reconcile request bodies verbatim without sanitization, so a value that leaks through here
 * ends up at rest, in backups, and readable over MCP.
 */
function toAllowedValue<TAllowed extends string>(
  raw: string | null | undefined,
  allowed: readonly TAllowed[],
  fallback: TAllowed | null,
): TAllowed | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  return (allowed as readonly string[]).includes(raw) ? (raw as TAllowed) : fallback;
}

/**
 * Restricts an error class to the transport allowlist, collapsing anything else to `unknown`.
 * An unrecognized value is deliberately NOT forwarded verbatim: on Android a raw error string
 * carries the database path, SQL fragments, and bound values (anime titles, in this app).
 */
export function normalizeSyncCycleErrorName(
  raw: string | null | undefined,
): SyncCycleErrorName | null {
  return toAllowedValue(raw, SYNC_CYCLE_ERROR_NAMES, 'unknown');
}

/** Restricts an error's transaction phase to the transport allowlist. */
export function normalizeSyncCycleErrorStage(
  raw: string | null | undefined,
): SyncCycleErrorStage | null {
  return toAllowedValue(raw, SYNC_CYCLE_ERROR_STAGES, 'unknown');
}

/**
 * Re-validates a persisted cycle checkpoint. The column is free-form TEXT, so a legacy or
 * corrupted row could hold anything; an unrecognized value is dropped rather than collapsed,
 * because "some unknown stage" carries no diagnostic value worth the transport risk.
 */
export function normalizeSyncCycleStage(
  raw: string | null | undefined,
): SyncCycleStage | null {
  return toAllowedValue(raw, SYNC_CYCLE_STAGES, null);
}

/**
 * Forwards a native error code only when it is a bounded non-negative integer.
 *
 * The runtime models `errcode` as `number | null` (`LocalWriteFailureDiagnostics`), not as a
 * `SQLITE_*` string -- it is the char code parsed out of the native message. Bounding an integer
 * is a stronger privacy guarantee than any string pattern: a number cannot encode a path, a
 * message, or an anime title under any interpretation.
 */
export function normalizeNativeErrcodeByte(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return null;
  }

  return raw >= 0 && raw <= NATIVE_ERRCODE_BYTE_MAX ? raw : null;
}

/**
 * Classifies how the PREVIOUS sync cycle ended, reading only what that cycle managed to persist.
 *
 * This exists because a cycle killed by the host (Android's `jobFinished` timeout) cannot report
 * its own death -- the process is gone before any reporting code runs. The one artifact it leaves
 * behind is a `isCycleActive` flag that was never released, because `recordCycleActive(false)`
 * lives in a `finally` that never executed. Reading that flag at the START of the next cycle is
 * therefore the only way this class of failure is ever observable off-device.
 *
 * Precedence is deliberate: `never_closed` outranks `failed`, because a cycle can record a failure
 * and then be killed before releasing the flag. The kill is the more severe fact and the one that
 * burns host execution quota, so it must not be masked by the error message underneath it.
 *
 * Returns `null` when no cycle has ever run, which is not an outcome and must not be reported as one.
 */
export function derivePreviousCycleOutcome(
  snapshot: SyncRuntimeStatusSnapshot,
): SyncCycleOutcome | null {
  if (snapshot.lastAttemptAt === null) {
    return null;
  }

  if (snapshot.isCycleActive) {
    return 'never_closed';
  }

  if (snapshot.lastFailureMessage !== null) {
    return 'failed';
  }

  return 'completed';
}

/**
 * Derives how long the previous cycle ran before its last observable checkpoint.
 * Clamped at zero so a device clock that moved backwards reports an unknown-but-sane duration
 * instead of a negative one that would read as a corrupt measurement upstream.
 */
function deriveElapsedMs(startedAt: number | null, now: number | undefined): number | null {
  if (startedAt === null || now === undefined) {
    return null;
  }

  return Math.max(0, now - startedAt);
}

/**
 * Reconstructs the previous cycle's post-mortem, or `null` when there is no history to report.
 */
function buildPreviousCycleTelemetry(
  snapshot: SyncRuntimeStatusSnapshot,
  now: number | undefined,
): PreviousCycleTelemetry | null {
  const outcome = derivePreviousCycleOutcome(snapshot);

  if (outcome === null) {
    return null;
  }

  return {
    cycleId: snapshot.lastCycleId,
    triggerSource: snapshot.lastTriggerSource,
    outcome,
    // Normalized on READ, not only on write: these columns are free-form TEXT, so a legacy row,
    // a corrupted value, or a future writer that forgets the contract must not become a leak.
    lastStage: normalizeSyncCycleStage(snapshot.lastCycleStage),
    startedAt: snapshot.lastAttemptAt,
    elapsedMs: deriveElapsedMs(snapshot.lastAttemptAt, now),
    errorName: normalizeSyncCycleErrorName(snapshot.lastErrorName),
    nativeErrcodeByte: normalizeNativeErrcodeByte(snapshot.lastNativeErrcodeByte),
    errorStage: normalizeSyncCycleErrorStage(snapshot.lastErrorStage),
    // Classified from the persisted raw message HERE, on the path to the wire, so the symbol
    // travels and the text stays on the device. This is also why no `last_error_cause` column
    // exists: deriving it at serialization time makes the scrub unbypassable by construction.
    errorCause: classifySyncCycleErrorCause(snapshot.lastFailureMessage),
    errorFingerprint: fingerprintSyncCycleErrorName(snapshot.lastErrorName),
  };
}

/**
 * Builds one cycle's telemetry envelope from the persisted runtime snapshot.
 *
 * Every field earns its place by answering a question that otherwise requires a USB cable:
 * `previousCycle.outcome` + `lastStage` say whether the last job died and in which tramo;
 * `triggerSource` removes the background-vs-manual ambiguity the bridge cannot otherwise resolve;
 * `counters.consecutiveUnclosedCycles` separates a one-off from an ongoing quota bleed; and the
 * structured error triple distinguishes lock contention (`SQLITE_BUSY`) from a closed native
 * handle -- two failures with the same symptom and different fixes.
 *
 * Pure by construction: the caller injects `now`, so this stays trivially testable.
 */
export function buildSyncCycleTelemetry(
  input: BuildSyncCycleTelemetryInput,
): SyncCycleTelemetry {
  return {
    cycleId: input.cycleId,
    triggerSource: input.triggerSource,
    appState: input.appState,
    previousCycle: buildPreviousCycleTelemetry(input.snapshot, input.now),
    counters: {
      consecutiveUnclosedCycles: input.snapshot.consecutiveUnclosedCycles,
      pendingOpsCount: input.pendingOpsCount,
      cursor: input.cursor,
    },
    recentEvents: input.recentEvents ?? [],
  };
}

/**
 * Serializes telemetry into the exact snake_case contract the bridge accepts.
 *
 * Written as an explicit field-by-field projection rather than a spread so the wire shape is a
 * closed set: a field added to the internal model never reaches the bridge until someone adds it
 * here on purpose. That is the boundary that keeps user data out of transport by construction.
 */
export function toWireSyncCycleTelemetry(
  telemetry: SyncCycleTelemetry,
): WireSyncCycleTelemetry {
  const previousCycle = telemetry.previousCycle;

  return {
    cycle_id: telemetry.cycleId,
    degraded: null,
    trigger_source: telemetry.triggerSource,
    app_state: telemetry.appState,
    previous_cycle: previousCycle
      ? {
          cycle_id: previousCycle.cycleId,
          trigger_source: previousCycle.triggerSource,
          outcome: previousCycle.outcome,
          last_stage: previousCycle.lastStage,
          started_at: previousCycle.startedAt,
          elapsed_ms: previousCycle.elapsedMs,
          error_name: previousCycle.errorName,
          native_errcode_byte: previousCycle.nativeErrcodeByte,
          error_stage: previousCycle.errorStage,
          error_cause: previousCycle.errorCause,
          error_fingerprint: previousCycle.errorFingerprint,
        }
      : null,
    counters: {
      consecutive_unclosed_cycles: telemetry.counters.consecutiveUnclosedCycles,
      pending_ops_count: telemetry.counters.pendingOpsCount,
      cursor: telemetry.counters.cursor,
    },
    recent_events: toWireDiagnosticEvents(telemetry.recentEvents),
  };
}

/**
 * Measures the serialized size of a telemetry payload in bytes.
 *
 * Character count equals byte count here by construction: every field is an enum member, a
 * number, a UUID, or a pattern-bounded `SQLITE_*` token, so the payload is ASCII-only. That
 * invariant is what the normalizers above exist to guarantee.
 */
function measureWireBytes(wire: WireSyncCycleTelemetry): number {
  return JSON.stringify(wire).length;
}

/**
 * Enforces the agreed transport budget, degrading in a fixed order instead of truncating.
 *
 * Order matters and is not arbitrary. Truncating JSON would produce an unparseable field, so
 * the payload sheds whole pieces from least to most diagnostic value: first the previous
 * cycle's error triple, then the previous cycle entirely, and only then does it decline to send
 * anything at all. `outcome` and `last_stage` survive longest because they are the two fields
 * that answer "did the job die, and where" -- the question this telemetry exists for.
 *
 * Returning `null` rather than an oversized payload is deliberate: a body past the bridge's
 * 64 KiB capture ceiling is dropped SILENTLY and takes the reconcile payload capture with it,
 * so an over-budget send would destroy observability the team already has.
 */
export function capWireSyncCycleTelemetry(
  wire: WireSyncCycleTelemetry,
  maxBytes: number = SYNC_CYCLE_TELEMETRY_MAX_BYTES,
): WireSyncCycleTelemetry | null {
  if (measureWireBytes(wire) <= maxBytes) {
    return wire;
  }

  // The event ring sheds FIRST. It is the only variable-size part of the payload, and under
  // pressure the specific diagnosis of this cycle is worth more than the surrounding pattern:
  // `outcome` and `last_stage` name the failure, the ring only contextualises it.
  if (wire.recent_events.length > 0) {
    // The tier is set on THIS intermediate, before it is measured: `measureWireBytes` must
    // count `degraded` itself, or the cap under-reports by up to 12 bytes (design.md Decision 1).
    const withoutEvents: WireSyncCycleTelemetry = {
      ...wire,
      recent_events: [],
      degraded: 'events',
    };

    if (measureWireBytes(withoutEvents) <= maxBytes) {
      return withoutEvents;
    }

    return capWireSyncCycleTelemetry(withoutEvents, maxBytes);
  }

  if (wire.previous_cycle !== null) {
    const withoutErrorDetail: WireSyncCycleTelemetry = {
      ...wire,
      degraded: 'error_detail',
      previous_cycle: {
        ...wire.previous_cycle,
        error_name: null,
        native_errcode_byte: null,
        error_stage: null,
        // `error_cause` is dropped with the rest of the detail, but it is the LAST thing worth
        // keeping if the budget ever tightens further: it names the fix, where the others only
        // describe the failure.
        error_cause: null,
        error_fingerprint: null,
      },
    };

    if (measureWireBytes(withoutErrorDetail) <= maxBytes) {
      return withoutErrorDetail;
    }
  }

  const withoutPreviousCycle: WireSyncCycleTelemetry = {
    ...wire,
    previous_cycle: null,
    degraded: 'previous_cycle',
  };

  if (measureWireBytes(withoutPreviousCycle) <= maxBytes) {
    return withoutPreviousCycle;
  }

  return null;
}

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
export function classifySyncCycleErrorCause(
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
 * Hashes a code identifier into 8 hex characters, one-way and closed-form.
 * FNV-1a is used rather than a crypto digest because the goal is stable GROUPING, not secrecy,
 * and this needs no dependency in a React Native runtime.
 */
function hashIdentifier(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Fingerprints an error class that has no symbol of its own, so novelty can still be grouped.
 *
 * Without this, every unrecognized class collapses into one `unknown` bucket, and the bridge's
 * filter is exact-match -- making "the same unknown 48 times" indistinguishable from "48
 * different unknowns". That is the wrong trade for a tool whose purpose is the NEXT unknown
 * problem.
 *
 * Two refusals are deliberate. A class already on the allowlist returns null, because it has a
 * better name than a hash. And a value that is not a bare identifier returns null, which is the
 * structural guarantee that a message can never be hashed: fingerprinting message text would
 * let a candidate list confirm anime titles by dictionary.
 */
export function fingerprintSyncCycleErrorName(
  rawName: string | null | undefined,
): string | null {
  if (typeof rawName !== 'string') {
    return null;
  }

  if ((SYNC_CYCLE_ERROR_NAMES as readonly string[]).includes(rawName)) {
    return null;
  }

  if (!SYNC_CYCLE_IDENTIFIER_PATTERN.test(rawName)) {
    return null;
  }

  return hashIdentifier(rawName);
}

/**
 * The single exit through which telemetry may reach the wire.
 *
 * User preference, size budget and serialization converge here on purpose. Leaving any of the
 * three to the caller would make them a convention that some future call site forgets; funnelled
 * into one function they are a property of the system, because no path to the wire bypasses it.
 * The kill switch in particular has to be a guarantee, not a habit.
 *
 * Returns `null` for every reason to stay silent -- switched off, nothing to report, or over
 * budget -- so the caller has exactly one case to handle and cannot accidentally distinguish
 * "declined" from "empty" in a way that leaks the difference onto the wire.
 */
export function resolveClientTelemetry(
  telemetry: SyncCycleTelemetry | undefined,
  config: { isSyncTelemetryEnabled?: unknown } | null,
  maxBytes: number = SYNC_CYCLE_TELEMETRY_MAX_BYTES,
): WireSyncCycleTelemetry | null {
  if (!telemetry || !isSyncTelemetryEnabled(config)) {
    return null;
  }

  return capWireSyncCycleTelemetry(toWireSyncCycleTelemetry(telemetry), maxBytes);
}

/**
 * Generates the correlation id for one cycle.
 *
 * Backed by `expo-crypto`, which uses the platform CSPRNG, rather than by a hand-rolled
 * `Math.random` shape. `Math.random` is not required to be uniformly distributed and gives no
 * collision guarantee across processes, and a colliding cycle id silently merges two devices'
 * cycles in the bridge's captures -- a wrong answer that reads as a valid one.
 *
 * Derived from NOTHING else: not the clock, not the device, not the install. Each of those would
 * smuggle onto the wire something the telemetry contract promises not to send, through a field
 * that looks innocuous. The generator stays injectable so tests can pin a value without asserting
 * on randomness itself.
 */
export function createSyncCycleId(generate: () => string = Crypto.randomUUID): string {
  return generate();
}

/**
 * Derives the canonical cause from a thrown value, for call sites that hold an error rather than
 * a persisted message.
 *
 * Exists so the four emission sites do not each re-implement "pull the message out, then
 * classify it" -- a duplication where one site eventually forwards the raw message by accident
 * and turns a privacy boundary into a leak. A non-Error throw yields `null` rather than being
 * stringified, because `String(value)` on an arbitrary object is exactly the kind of free text
 * this contract exists to keep off the wire.
 */
export function causeFromError(error: unknown): SyncCycleErrorCause | null {
  return classifySyncCycleErrorCause(error instanceof Error ? error.message : null);
}
