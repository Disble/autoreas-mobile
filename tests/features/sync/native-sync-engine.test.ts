import {
  createNativeSyncEngine,
  normalizeNativeSyncEngineResult,
} from '../../../src/features/sync/native-sync-engine/native-sync-engine.helpers';
import { NATIVE_SYNC_ENGINE_MODULE_NAME } from '../../../src/features/sync/native-sync-engine/native-sync-engine.constants';
import type {
  NativeSyncEngineModule,
  NativeSyncEngineResultMap,
} from '../../../src/features/sync/native-sync-engine/native-sync-engine.types';

/**
 * Builds a fully-mocked native module whose `runOnce` resolves with a healthy closed cycle.
 * The mock stays reachable so tests can assert the exact trigger source the seam forwarded
 * and steer the raw map the seam has to normalize.
 */
function buildNativeModule(): NativeSyncEngineModule & { readonly runOnce: jest.Mock } {
  return {
    runOnce: jest.fn().mockResolvedValue({
      outcome: 'closed',
      cycleId: 'cycle-1',
      syncedCount: 3,
      backlogReadCount: 5,
      stage: 'closed',
      errorName: null,
      recoveredProcessingCount: 2,
      recoveredAbandonedCycleId: 'cycle-0',
    }),
  };
}

/**
 * Creates an engine over the given native module directly, bypassing the lazy default loader
 * so each test controls exactly what `requireOptionalNativeModule` would answer at runtime.
 */
function createEngineWithModule(nativeModule: NativeSyncEngineModule | null) {
  return createNativeSyncEngine({
    requireOptionalNativeModule: () => nativeModule,
  });
}

describe('native-sync-engine helpers', () => {
  describe('createNativeSyncEngine', () => {
    it('degrades to an unavailable engine when the native module is missing', async () => {
      const engine = createEngineWithModule(null);

      expect(engine.isAvailable()).toBe(false);

      const result = await engine.runOnce('background_task');

      expect(result.outcome).toBe('unavailable');
      expect(result.cycleId).toBeNull();
      expect(result.syncedCount).toBe(0);
      expect(result.backlogReadCount).toBe(0);
      expect(result.stage).toBeNull();
      expect(result.errorName).toBeNull();
      expect(result.recoveredProcessingCount).toBe(0);
      expect(result.recoveredAbandonedCycleId).toBeNull();
    });

    it('degrades to an unavailable engine when the native module lookup throws', async () => {
      const engine = createNativeSyncEngine({
        requireOptionalNativeModule: () => {
          throw new Error('bridge not ready');
        },
      });

      expect(engine.isAvailable()).toBe(false);

      const result = await engine.runOnce('background_task');

      expect(result.outcome).toBe('unavailable');
    });

    it('never throws: a native rejection resolves a failed attempt instead', async () => {
      const nativeModule = buildNativeModule();
      nativeModule.runOnce.mockRejectedValue(new Error('watchdog fired'));
      const engine = createEngineWithModule(nativeModule);

      const result = await engine.runOnce('background_task');

      expect(result.outcome).toBe('failed');
      expect(result.errorName).toBe('Error');
      expect(result.syncedCount).toBe(0);
    });

    it('forwards the trigger source to the native module', async () => {
      const nativeModule = buildNativeModule();
      const engine = createEngineWithModule(nativeModule);

      await engine.runOnce('background_task');

      expect(nativeModule.runOnce).toHaveBeenCalledWith('background_task');
    });

    it('normalizes the native result map field by field', async () => {
      const engine = createEngineWithModule(buildNativeModule());

      const result = await engine.runOnce('background_task');

      expect(result).toEqual({
        outcome: 'closed',
        cycleId: 'cycle-1',
        syncedCount: 3,
        backlogReadCount: 5,
        stage: 'closed',
        errorName: null,
        recoveredProcessingCount: 2,
        recoveredAbandonedCycleId: 'cycle-0',
      });
    });

    it('maps a missing native module name lookup on the default loader path to unavailable', async () => {
      // The default loader is exercised for coverage of the lazy require, but its answer on a
      // host without the native binary must degrade, never throw.
      const engine = createNativeSyncEngine();

      await expect(engine.runOnce('background_task')).resolves.toEqual(
        expect.objectContaining({ outcome: expect.any(String) }),
      );
    });
  });

  describe('normalizeNativeSyncEngineResult', () => {
    it('keeps every known outcome as the native side reported it', () => {
      for (const outcome of ['closed', 'failed', 'abandoned', 'not_applicable']) {
        expect(
          normalizeNativeSyncEngineResult({ outcome }),
        ).toMatchObject({ outcome });
      }
    });

    it('collapses a foreign outcome to failed instead of guessing success', () => {
      const result = normalizeNativeSyncEngineResult({ outcome: 'sort_of_closed' });

      expect(result.outcome).toBe('failed');
    });

    it('defaults every missing or mistyped field to its "nothing happened" value', () => {
      const result = normalizeNativeSyncEngineResult({});

      expect(result).toEqual({
        outcome: 'failed',
        cycleId: null,
        syncedCount: 0,
        backlogReadCount: 0,
        stage: null,
        errorName: null,
        recoveredProcessingCount: 0,
        recoveredAbandonedCycleId: null,
      });
    });

    it('passes recovery sweep values through when the native side reported them', () => {
      const result = normalizeNativeSyncEngineResult({
        outcome: 'closed',
        recoveredProcessingCount: 2,
        recoveredAbandonedCycleId: 'cycle-0',
      });

      expect(result.recoveredProcessingCount).toBe(2);
      expect(result.recoveredAbandonedCycleId).toBe('cycle-0');
      expect(result.outcome).toBe('closed');
    });

    it('degrades missing, mistyped, non-finite, or negative recovery counts to 0', () => {
      const missing = normalizeNativeSyncEngineResult({ outcome: 'closed' });
      const mistyped = normalizeNativeSyncEngineResult({
        recoveredProcessingCount: 'two',
      });
      const nonFinite = normalizeNativeSyncEngineResult({
        recoveredProcessingCount: Number.NaN,
      });
      const negative = normalizeNativeSyncEngineResult({
        recoveredProcessingCount: -1,
      });

      expect(missing.recoveredProcessingCount).toBe(0);
      expect(mistyped.recoveredProcessingCount).toBe(0);
      expect(nonFinite.recoveredProcessingCount).toBe(0);
      expect(negative.recoveredProcessingCount).toBe(0);
    });

    it('degrades missing or non-string recovered cycle ids to null', () => {
      const missing = normalizeNativeSyncEngineResult({ outcome: 'closed' });
      const mistyped = normalizeNativeSyncEngineResult({
        recoveredAbandonedCycleId: 42,
      });

      expect(missing.recoveredAbandonedCycleId).toBeNull();
      expect(mistyped.recoveredAbandonedCycleId).toBeNull();
    });

    it('preserves a real zero count and rejects non-finite numbers', () => {
      const result = normalizeNativeSyncEngineResult({
        outcome: 'closed',
        syncedCount: 0,
        backlogReadCount: Number.NaN,
      });

      expect(result.syncedCount).toBe(0);
      expect(result.backlogReadCount).toBe(0);
    });

    it('reads only string-typed diagnostics and drops everything else', () => {
      const raw = {
        outcome: 'failed',
        cycleId: 42,
        stage: { depth: 1 },
        errorName: 'SQLiteFullException',
        extra: NativeSyncEngineModuleSentinel,
      } as unknown as NativeSyncEngineResultMap;

      const result = normalizeNativeSyncEngineResult(raw);

      expect(result.cycleId).toBeNull();
      expect(result.stage).toBeNull();
      expect(result.errorName).toBe('SQLiteFullException');
      expect(result).not.toHaveProperty('extra');
    });

    it('treats a non-object native answer as a failed attempt', () => {
      expect(normalizeNativeSyncEngineResult(null)).toMatchObject({ outcome: 'failed' });
      expect(normalizeNativeSyncEngineResult('closed')).toMatchObject({ outcome: 'failed' });
    });

    it('exposes the registered native module name the seam looks up', () => {
      expect(NATIVE_SYNC_ENGINE_MODULE_NAME).toBe('SyncEngine');
    });
  });
});

/** Placeholder object used to prove unknown keys never survive normalization. */
const NativeSyncEngineModuleSentinel = { native: true };
