import { createSyncJournal, createJournalRecordingCheckpointRecorder } from '../../../src/features/sync/sync-journal/sync-journal.helpers';
import type { SyncCycleStage } from '../../../src/features/sync/sync-runtime-status.types';
import type {
  JournalAttemptState,
  JournalRecordingCheckpointRecorder,
  JournalTransition,
  NativeSyncJournalModule,
  SyncJournal,
} from '../../../src/features/sync/sync-journal/sync-journal.types';

/**
 * Builds a fully-mocked native module whose four async functions all resolve with their
 * "healthy" defaults. Each mock stays reachable through the returned intersection so tests
 * can assert the exact positional payload the seam forwarded.
 */
function buildNativeModule(): NativeSyncJournalModule & {
  readonly recordTransition: jest.Mock;
  readonly readLatestTransition: jest.Mock;
  readonly readTransitions: jest.Mock;
  readonly countTransitions: jest.Mock;
} {
  return {
    recordTransition: jest.fn().mockResolvedValue(true),
    readLatestTransition: jest.fn().mockResolvedValue(null),
    readTransitions: jest.fn().mockResolvedValue([]),
    countTransitions: jest.fn().mockResolvedValue(0),
  };
}

/**
 * Creates a journal over the given native module directly, bypassing the lazy default loader so
 * each test controls exactly what `requireOptionalNativeModule` would have answered at runtime.
 */
function createJournalWithModule(nativeModule: NativeSyncJournalModule): SyncJournal {
  return createSyncJournal({ requireOptionalNativeModule: () => nativeModule });
}

describe('sync-journal helpers', () => {
  describe('createSyncJournal', () => {
    it('degrades to a no-op journal when the native module is unavailable', async () => {
      const journal = createSyncJournal({ requireOptionalNativeModule: () => null });

      expect(journal.isAvailable()).toBe(false);
      await expect(
        journal.recordTransition({
          cycleId: 'cycle-1',
          fromState: 'idle',
          toState: 'checked',
          reason: null,
          atMs: 1_000,
        }),
      ).resolves.toBe(false);
      await expect(journal.readLatestTransition()).resolves.toBeNull();
      await expect(journal.readTransitions('cycle-1', 10)).resolves.toEqual([]);
      await expect(journal.countTransitions()).resolves.toBe(0);
    });

    it('degrades to a no-op journal when the native module lookup throws', async () => {
      const journal = createSyncJournal({
        requireOptionalNativeModule: () => {
          throw new Error('bridge not ready');
        },
      });

      expect(journal.isAvailable()).toBe(false);
      await expect(journal.countTransitions()).resolves.toBe(0);
    });

    it('never rejects: a native failure resolves the journal defaults instead', async () => {
      const nativeModule = buildNativeModule();
      nativeModule.recordTransition.mockRejectedValue(new Error('sqlite busy'));
      nativeModule.readLatestTransition.mockRejectedValue(new Error('sqlite busy'));
      nativeModule.readTransitions.mockRejectedValue(new Error('sqlite busy'));
      nativeModule.countTransitions.mockRejectedValue(new Error('sqlite busy'));
      const journal = createJournalWithModule(nativeModule);

      await expect(
        journal.recordTransition({
          cycleId: 'cycle-1',
          fromState: 'idle',
          toState: 'checked',
          reason: null,
          atMs: 1_000,
        }),
      ).resolves.toBe(false);
      await expect(journal.readLatestTransition()).resolves.toBeNull();
      await expect(journal.readTransitions('cycle-1', 10)).resolves.toEqual([]);
      await expect(journal.countTransitions()).resolves.toBe(0);
    });

    it('forwards recordTransition to the native module with positional arguments', async () => {
      const nativeModule = buildNativeModule();
      const journal = createJournalWithModule(nativeModule);
      const transition: JournalTransition = {
        cycleId: 'cycle-1',
        fromState: 'checked',
        toState: 'claimed',
        reason: null,
        atMs: 1_234,
      };

      await expect(journal.recordTransition(transition)).resolves.toBe(true);

      expect(nativeModule.recordTransition).toHaveBeenCalledWith(
        'cycle-1',
        'checked',
        'claimed',
        null,
        1_234,
      );
    });

    it('forwards the read surface to the native module', async () => {
      const nativeModule = buildNativeModule();
      const latest: JournalTransition = {
        cycleId: 'cycle-1',
        fromState: 'sent',
        toState: 'applied',
        reason: null,
        atMs: 2_000,
      };
      nativeModule.readLatestTransition.mockResolvedValue(latest);
      nativeModule.readTransitions.mockResolvedValue([latest]);
      nativeModule.countTransitions.mockResolvedValue(7);
      const journal = createJournalWithModule(nativeModule);

      await expect(journal.readLatestTransition()).resolves.toEqual(latest);
      await expect(journal.readTransitions('cycle-1', 5)).resolves.toEqual([latest]);
      expect(nativeModule.readTransitions).toHaveBeenCalledWith('cycle-1', 5);
      await expect(journal.countTransitions()).resolves.toBe(7);
      expect(journal.isAvailable()).toBe(true);
    });
  });

  describe('createJournalRecordingCheckpointRecorder', () => {
    type RecordedCall = JournalTransition;

    function buildRecordingJournal(nativeModule: NativeSyncJournalModule) {
      const journal = createJournalWithModule(nativeModule);
      const recorded: RecordedCall[] = [];
      const instrumented: SyncJournal = {
        ...journal,
        recordTransition: async (transition) => {
          recorded.push(transition);

          return journal.recordTransition(transition);
        },
      };

      return { instrumented, recorded };
    }

    function buildRecorder(journal: SyncJournal): {
      recorder: JournalRecordingCheckpointRecorder;
      wrapped: jest.Mock;
    } {
      const wrapped = jest.fn();

      return {
        recorder: createJournalRecordingCheckpointRecorder({
          journal,
          cycleId: 'cycle-1',
          recorder: wrapped,
        }),
        wrapped,
      };
    }

    it('records idle -> checked when the first published stage is open', () => {
      const nativeModule = buildNativeModule();
      const { instrumented, recorded } = buildRecordingJournal(nativeModule);
      const { recorder } = buildRecorder(instrumented);

      recorder('open');

      expect(recorded).toEqual([
        { cycleId: 'cycle-1', fromState: 'idle', toState: 'checked', reason: null, atMs: expect.any(Number) },
      ]);
    });

    it('maps the whole published stage vocabulary onto the FSM transition chain', () => {
      const nativeModule = buildNativeModule();
      const { instrumented, recorded } = buildRecordingJournal(nativeModule);
      const { recorder } = buildRecorder(instrumented);
      const stageSequence: SyncCycleStage[] = [
        'open',
        'config',
        'attempt_started',
        'cycle_activated',
        'backlog_read',
        'claim_ops',
        'http',
        'parse_response',
        'apply_write',
        'prune',
        'closed',
      ];

      stageSequence.forEach((stage) => recorder(stage));

      const expectedChain: [JournalAttemptState, JournalAttemptState][] = [
        ['idle', 'checked'],
        ['checked', 'checked'],
        ['checked', 'checked'],
        ['checked', 'checked'],
        ['checked', 'checked'],
        ['checked', 'claimed'],
        ['claimed', 'sent'],
        ['sent', 'sent'],
        ['sent', 'applied'],
        ['applied', 'pruned'],
        ['pruned', 'closed'],
      ];

      expect(recorded.map((transition) => [transition.fromState, transition.toState])).toEqual(
        expectedChain,
      );
      expect(recorded.every((transition) => transition.cycleId === 'cycle-1')).toBe(true);
    });

    it('ignores a stage outside the FSM vocabulary but still forwards it to the wrapped recorder', () => {
      const nativeModule = buildNativeModule();
      const { instrumented, recorded } = buildRecordingJournal(nativeModule);
      const { recorder, wrapped } = buildRecorder(instrumented);
      const unlistedStage = 'reconcile' as SyncCycleStage;

      recorder('cycle_activated');
      recorder(unlistedStage);

      expect(wrapped).toHaveBeenCalledWith('reconcile');
      // Only the listed stage produced a journal row; the unlisted one changed nothing.
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.toState).toBe('checked');
    });

    it('forwards every stage to the wrapped recorder unchanged', () => {
      const nativeModule = buildNativeModule();
      const { instrumented } = buildRecordingJournal(nativeModule);
      const { recorder, wrapped } = buildRecorder(instrumented);

      recorder('open');
      recorder('claim_ops');
      recorder('closed');

      expect(wrapped.mock.calls.map((call) => call[0])).toEqual([
        'open',
        'claim_ops',
        'closed',
      ]);
    });

    it('keeps recording with correct state tracking when a journal write fails', () => {
      const nativeModule = buildNativeModule();
      nativeModule.recordTransition.mockResolvedValue(false);
      const { instrumented, recorded } = buildRecordingJournal(nativeModule);
      const { recorder } = buildRecorder(instrumented);

      expect(() => recorder('open')).not.toThrow();
      expect(() => recorder('claim_ops')).not.toThrow();

      expect(recorded.map((transition) => [transition.fromState, transition.toState])).toEqual([
        ['idle', 'checked'],
        ['checked', 'claimed'],
      ]);
    });

    it('records failed through recordFailure, keeping the previous state as fromState', () => {
      const nativeModule = buildNativeModule();
      const { instrumented, recorded } = buildRecordingJournal(nativeModule);
      const { recorder } = buildRecorder(instrumented);

      recorder('http');
      recorder.recordFailure('Network Error');

      expect(recorded.at(-1)).toEqual({
        cycleId: 'cycle-1',
        fromState: 'sent',
        toState: 'failed',
        reason: 'Network Error',
        atMs: expect.any(Number),
      });
    });

    it('records abandoned through recordAbandoned, keeping the previous state as fromState', () => {
      const nativeModule = buildNativeModule();
      const { instrumented, recorded } = buildRecordingJournal(nativeModule);
      const { recorder } = buildRecorder(instrumented);

      recorder('prune');
      recorder.recordAbandoned("Background sync cycle abandoned after 35000ms at stage 'prune'");

      expect(recorded.at(-1)).toEqual({
        cycleId: 'cycle-1',
        fromState: 'pruned',
        toState: 'abandoned',
        reason: "Background sync cycle abandoned after 35000ms at stage 'prune'",
        atMs: expect.any(Number),
      });
    });

    it('still forwards stages to the wrapped recorder when the journal is unavailable', () => {
      const unavailableJournal = createSyncJournal({ requireOptionalNativeModule: () => null });
      const { recorder, wrapped } = buildRecorder(unavailableJournal);

      expect(() => recorder('open')).not.toThrow();
      expect(() => recorder.recordFailure('boom')).not.toThrow();
      expect(() => recorder.recordAbandoned('boom')).not.toThrow();
      expect(wrapped).toHaveBeenCalledWith('open');
    });
  });
});
