import type { SYNC_CYCLE_ERROR_CAUSES } from '../sync/sync-telemetry.constants';
import type { SyncDiagnosticsOutboxStore } from '../../infrastructure/db/sync-diagnostics-outbox';
import type {
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
}

/**
 * Collaborators the recorder resolves per call. All three default to their production values and
 * exist so a test can observe the wire payload without a real SQLite file, a real clock, or a
 * random id.
 */
export interface ChapterActionDiagnosticsParams {
  readonly store?: Pick<SyncDiagnosticsOutboxStore, 'enqueue'>;
  readonly now?: () => number;
  readonly generateId?: () => string;
}

/**
 * One observation before it becomes a wire payload. The optional members are phase-specific: a
 * skipped action carries only a reason, a finished one only an outcome and its duration, and only
 * a failed finish carries a cause.
 */
export interface ChapterActionObservation {
  readonly action: ChapterActionLabel;
  readonly phase: ChapterActionPhase;
  readonly outcome?: ChapterActionFinishedOutcome | ChapterActionSyncOutcome;
  readonly reason?: ChapterActionSkippedReason;
  readonly cause?: ChapterActionCause;
  readonly durationMs?: number;
}
