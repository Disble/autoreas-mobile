import {
  JOURNAL_INITIAL_STATE,
  STAGE_TO_JOURNAL_STATE,
  SYNC_JOURNAL_NATIVE_MODULE_NAME,
} from './sync-journal.constants';
import {
  loadDefaultOptionalNativeModuleLoader,
  loadOptionalNativeModule,
} from '../native-module-loader/native-module-loader.helpers';
import type { SyncCycleStage } from '../sync-runtime-status.types';
import type {
  CreateJournalRecordingCheckpointRecorderParams,
  CreateSyncJournalParams,
  JournalAttemptState,
  JournalRecordingCheckpointRecorder,
  JournalTransition,
  NativeSyncJournalModule,
  SyncJournal,
} from './sync-journal.types';

// The lazily-required `expo-modules-core` loader and the guarded null lookup live in
// `../native-module-loader`, shared by the ticker, sync-engine, and sync-journal seams.

/**
 * Builds the no-op journal used whenever the native module is absent (Expo Go, iOS, or a
 * non-prebuilt binary). Every method answers with its "nothing recorded" default and none
 * throws: callers cannot and must not distinguish an empty journal from an unavailable one.
 */
function createUnavailableSyncJournal(): SyncJournal {
  return {
    recordTransition: () => Promise.resolve(false),
    readLatestTransition: () => Promise.resolve(null),
    readTransitions: () => Promise.resolve([]),
    countTransitions: () => Promise.resolve(0),
    isAvailable: () => false,
  };
}

/**
 * Creates the JS-side seam over the native sync-journal module. When the native module is
 * unavailable this degrades to a no-op journal instead of crashing or throwing -- the cycle
 * simply runs uninstrumented until a native build is installed; callers can observe this via
 * `isAvailable()` staying false. Even over a present module, every call still guards
 * rejections: the journal is an instrument, not a participant, so a failure answers with the
 * call's default (`false` / `null` / `[]` / `0`) rather than rejecting into the cycle.
 */
export function createSyncJournal(params: CreateSyncJournalParams = {}): SyncJournal {
  const loadModule =
    params.requireOptionalNativeModule ??
    loadDefaultOptionalNativeModuleLoader<NativeSyncJournalModule>();
  const nativeModule = loadOptionalNativeModule(loadModule, SYNC_JOURNAL_NATIVE_MODULE_NAME);

  if (!nativeModule) {
    return createUnavailableSyncJournal();
  }

  return {
    recordTransition(transition: JournalTransition): Promise<boolean> {
      return nativeModule
        .recordTransition(
          transition.cycleId,
          transition.fromState,
          transition.toState,
          transition.reason,
          transition.atMs,
        )
        .catch(() => false);
    },

    readLatestTransition(): Promise<JournalTransition | null> {
      return nativeModule.readLatestTransition().catch(() => null);
    },

    readTransitions(cycleId: string, limit: number): Promise<JournalTransition[]> {
      return nativeModule.readTransitions(cycleId, limit).catch(() => []);
    },

    countTransitions(): Promise<number> {
      return nativeModule.countTransitions().catch(() => 0);
    },

    isAvailable(): boolean {
      return true;
    },
  };
}

/**
 * Wraps a checkpoint recorder so every published stage is also appended to the sync journal as
 * an FSM transition, using {@link STAGE_TO_JOURNAL_STATE}; a stage with no mapping is ignored
 * by the journal but still forwarded to the wrapped recorder unchanged.
 *
 * Intent before effect: the recorder is called when the stage is published, BEFORE the step it
 * names is awaited, so the transition lands (fire-and-forget, never awaited) before the work
 * begins -- a cycle that parks inside a step therefore reports the state it parked in, not the
 * one before it. The journal is an instrument, not a participant: a `false` from
 * `recordTransition` changes nothing the cycle does, and `recordFailure`/`recordAbandoned` are
 * the only paths to the terminal `failed`/`abandoned` states, both keeping the previous state
 * as `fromState`.
 */
export function createJournalRecordingCheckpointRecorder(
  params: CreateJournalRecordingCheckpointRecorderParams,
): JournalRecordingCheckpointRecorder {
  const { journal, cycleId, recorder } = params;
  let currentState: JournalAttemptState = JOURNAL_INITIAL_STATE;

  function appendTransition(toState: JournalAttemptState, reason: string | null): void {
    const fromState = currentState;

    currentState = toState;
    // Fire-and-forget on purpose: the write must not be awaited where it could change control
    // flow, and a rejection must not surface -- the journal degrades to silence, never error.
    void journal
      .recordTransition({ cycleId, fromState, toState, reason, atMs: Date.now() })
      .catch(() => undefined);
  }

  const journalRecorder = (stage: SyncCycleStage): void => {
    // Forward FIRST and unchanged: the existing checkpoint behaviour keeps its exact ordering
    // and error contract, and the journal append can never delay or swallow it.
    recorder(stage);

    const toState: JournalAttemptState | undefined = STAGE_TO_JOURNAL_STATE[stage];

    if (!toState) {
      return;
    }

    appendTransition(toState, null);
  };

  return Object.assign(journalRecorder, {
    recordFailure: (reason: string): void => {
      appendTransition('failed', reason);
    },
    recordAbandoned: (reason: string): void => {
      appendTransition('abandoned', reason);
    },
  }) as JournalRecordingCheckpointRecorder;
}
