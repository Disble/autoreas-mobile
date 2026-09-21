import type { OptionalNativeModuleLoader } from '../native-module-loader/native-module-loader.types';
import type { SyncCycleCheckpointRecorder } from '../reconcile.types';

/**
 * The attempt state machine's vocabulary (docs/mobile-sync-architecture.md 6.2), exactly as the
 * journal records it: only states with a compensating action (or a terminal outcome) are states.
 * - `idle`      — a trigger was accepted, nothing was done
 * - `checked`   — presence OK, config read, lease taken
 * - `claimed`   — the batch is marked `processing`
 * - `sent`      — an HTTP request was issued (its compensation is ambiguous: reconcile)
 * - `applied`   — remote changes are applied locally
 * - `pruned`    — the operation log was truncated
 * - `closed` / `failed` / `abandoned` — terminal
 */
export type JournalAttemptState =
  | 'idle'
  | 'checked'
  | 'claimed'
  | 'sent'
  | 'applied'
  | 'pruned'
  | 'closed'
  | 'failed'
  | 'abandoned';

/** Defines one durable FSM transition row as the journal stores and returns it. */
export interface JournalTransition {
  /** Correlates the transition with the cycle that produced it. */
  readonly cycleId: string;
  /** State the machine was in before this transition; `null` when unknown to the writer. */
  readonly fromState: JournalAttemptState | null;
  /** State the machine entered. */
  readonly toState: JournalAttemptState;
  /** Why the transition happened — a failure or abandonment reason, otherwise `null`. */
  readonly reason: string | null;
  /** Wall-clock instant the transition was recorded, in epoch milliseconds. */
  readonly atMs: number;
}

/**
 * Defines the raw native module surface exposed by the `SyncJournal` local Expo module. The
 * native side resolves every call (never rejects) and answers failures with the defaults below;
 * the JS seam still guards rejections so a bridge-level failure degrades the same way.
 */
export interface NativeSyncJournalModule {
  readonly recordTransition: (
    cycleId: string,
    fromState: string | null,
    toState: string,
    reason: string | null,
    atMs: number,
  ) => Promise<boolean>;
  readonly readLatestTransition: () => Promise<JournalTransition | null>;
  readonly readTransitions: (cycleId: string, limit: number) => Promise<JournalTransition[]>;
  readonly countTransitions: () => Promise<number>;
}

/** Defines the loader function signature for the optional native journal module lookup. */
export type RequireOptionalNativeModule = OptionalNativeModuleLoader<NativeSyncJournalModule>;

/** Defines the data contract for create sync journal params. */
export interface CreateSyncJournalParams {
  readonly requireOptionalNativeModule?: RequireOptionalNativeModule;
}

/**
 * Defines the JS-side seam over the native sync journal. Every call is best-effort: the journal
 * is an instrument, not a participant, so no call throws, rejects, or changes a caller's control
 * flow — a failure answers `false` / `null` / `[]` / `0`.
 */
export interface SyncJournal {
  readonly recordTransition: (transition: JournalTransition) => Promise<boolean>;
  readonly readLatestTransition: () => Promise<JournalTransition | null>;
  readonly readTransitions: (cycleId: string, limit: number) => Promise<JournalTransition[]>;
  readonly countTransitions: () => Promise<number>;
  readonly isAvailable: () => boolean;
}

/**
 * Defines the checkpoint-recorder wrapper the headless sync cycle installs: callable exactly
 * like a {@link SyncCycleCheckpointRecorder}, plus the explicit terminal outcomes the FSM only
 * reaches on purpose. `recordFailure` and `recordAbandoned` are fire-and-forget like `record`.
 */
export type JournalRecordingCheckpointRecorder = SyncCycleCheckpointRecorder & {
  readonly recordFailure: (reason: string) => void;
  readonly recordAbandoned: (reason: string) => void;
};

/** Defines the data contract for create journal recording checkpoint recorder params. */
export interface CreateJournalRecordingCheckpointRecorderParams {
  /** The journal every recorded transition is appended to. */
  readonly journal: SyncJournal;
  /** Correlation id stamped on every transition this recorder records. */
  readonly cycleId: string;
  /** The wrapped checkpoint recorder each published stage is forwarded to unchanged. */
  readonly recorder: SyncCycleCheckpointRecorder;
}
