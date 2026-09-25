import type { SYNC_CYCLE_ERROR_CAUSES } from '../sync/sync-telemetry.constants';
import type { SyncDiagnosticsOutboxStore } from '../../infrastructure/db/sync-diagnostics-outbox';
import type {
  CHAPTER_ACTION_EVENT_KIND,
  CHAPTER_ACTION_FINISHED_OUTCOMES,
  CHAPTER_ACTION_OPTIONAL_FIELDS,
  CHAPTER_ACTION_PHASES,
  CHAPTER_ACTION_SKIPPED_REASONS,
  CHAPTER_ACTION_SYNC_OUTCOMES,
  CHAPTER_ACTION_WIRE_ACTIONS,
} from './chapter-action-diagnostics.constants';

/** The in-app label of one chapter gesture; also the key of its wire token. */
export type ChapterActionLabel = keyof typeof CHAPTER_ACTION_WIRE_ACTIONS;

/** One milestone of an action, as forwarded to the bridge. */
export type ChapterActionPhase = (typeof CHAPTER_ACTION_PHASES)[number];

/** Why an action produced no local change. */
export type ChapterActionSkippedReason = (typeof CHAPTER_ACTION_SKIPPED_REASONS)[number];

/** How the local write itself ended. */
export type ChapterActionFinishedOutcome = (typeof CHAPTER_ACTION_FINISHED_OUTCOMES)[number];

/** How the post-write push to the bridge ended. */
export type ChapterActionSyncOutcome = (typeof CHAPTER_ACTION_SYNC_OUTCOMES)[number];

/**
 * Every outcome token any phase may carry, across both closed vocabularies.
 *
 * Deliberately a union of the two rather than one shared list: `failed` is the only token the two
 * have in common, and that overlap is why a payload's outcome means nothing until the payload's
 * own phase is read next to it -- a `failed` write and a `failed` push are different findings.
 */
export type ChapterActionOutcome = ChapterActionFinishedOutcome | ChapterActionSyncOutcome;

/**
 * One phase-specific observation field, as named on `ChapterActionObservation`.
 *
 * Derived from the vocabulary itself rather than re-listed, so a phase that starts carrying a new
 * field cannot be forgotten by the recorder's "nothing out of place" check.
 */
export type ChapterActionOptionalField = (typeof CHAPTER_ACTION_OPTIONAL_FIELDS)[number];

/**
 * Failure classes a chapter action may report. Reuses the sync feature's closed cause vocabulary
 * so "which fix applies" reads the same way here as it does in cycle telemetry, and so no raw
 * error message can ever be forwarded.
 */
export type ChapterActionCause = (typeof SYNC_CYCLE_ERROR_CAUSES)[number];

/**
 * One action's identity, created when the JS callback is received and carried through the
 * mutation path so every later observation of that same action can be joined to it.
 *
 * `correlationId` is what makes two sequential presses distinguishable; without it a repeating
 * failure would be a bag of identical observations with no way to tell one gesture from three.
 */
export interface ChapterActionContext {
  readonly action: ChapterActionLabel;
  readonly correlationId: string;
  readonly startedAt: number;
  /**
   * The user's telemetry preference, resolved ONCE when the action was opened and carried by the
   * context from then on.
   *
   * On the context rather than re-read per phase because the switch is a per-action decision, not
   * a per-observation one: a tap that started while the user had telemetry off must not emit its
   * later phases if the switch is flipped mid-action, and a tap that started while it was on must
   * not lose them. One resolution also means the flag cannot disagree with itself between the
   * phases of a single gesture.
   */
  readonly isTelemetryEnabled: boolean;
}

/**
 * Collaborators the recorder resolves per call. All of them default to their production values and
 * exist so a test can observe the wire payload without a real SQLite file, a real clock, or a
 * random id.
 */
export interface ChapterActionDiagnosticsParams {
  readonly store?: Pick<SyncDiagnosticsOutboxStore, 'enqueue'>;
  readonly now?: () => number;
  readonly generateId?: () => string;
  /**
   * The user's diagnostic-telemetry preference, resolved by the caller that already holds the
   * bridge-config row. `false` mutes the WHOLE action: no phase reaches the outbox, not even the
   * receipt, and nothing is built. Injectable so both switch positions are drivable without a
   * database; absent follows `isSyncTelemetryEnabled`'s nullish rule and means enabled.
   */
  readonly isTelemetryEnabled?: boolean;
}

/**
 * One observation before it becomes a wire payload. The optional members are phase-specific: a
 * skipped action carries only a reason, a finished one only an outcome and its duration, and only
 * a failed finish carries a cause.
 */
export interface ChapterActionObservation {
  readonly action: ChapterActionLabel;
  readonly phase: ChapterActionPhase;
  readonly outcome?: ChapterActionOutcome;
  readonly reason?: ChapterActionSkippedReason;
  readonly cause?: ChapterActionCause;
  /**
   * A measured elapsed time, honored only on `finished`.
   *
   * Absent means "measure it from the action's receipt", which the builder does for a finished
   * write. On every other phase the field is a mistake rather than a missing value: those bodies
   * carry `duration_ms: null` on purpose, so a duration reaching the builder from any phase but
   * `finished` drops the whole observation instead of being forwarded.
   */
  readonly durationMs?: number;
}

/**
 * The exact JSON body one observation becomes, and the complete list of keys it may carry.
 *
 * There is deliberately no field for an anime, a title, a patch, SQL or an error message: the
 * bridge stores request bodies verbatim, so any key added here persists at rest and travels with
 * backups. The bridge decodes this body strictly -- an undeclared key anywhere is a rejection --
 * so this interface is the complete contract rather than a helpful subset of one.
 *
 * Two keys exist to constrain the shape rather than to describe the event:
 * - `observation_id` is minted once per observation and is ALSO the outbox row's own id, so a
 *   stored body re-posted after a restart carries the idempotency key the bridge deduplicates on;
 * - `duration_ms` is present on every body, `null` where a duration does not apply, because the
 *   decoder expects the key on every phase and accepts a non-null value on `finished` only.
 */
export interface ChapterActionWirePayload {
  readonly kind: typeof CHAPTER_ACTION_EVENT_KIND;
  readonly observation_id: string;
  readonly action: (typeof CHAPTER_ACTION_WIRE_ACTIONS)[ChapterActionLabel];
  readonly phase: ChapterActionPhase;
  readonly observed_at_ms: number;
  readonly correlation_id: string;
  readonly duration_ms: number | null;
  readonly outcome?: ChapterActionOutcome;
  readonly reason?: ChapterActionSkippedReason;
  readonly cause?: ChapterActionCause;
}
