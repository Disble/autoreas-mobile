import {
  NATIVE_OUTCOMES,
  NATIVE_SYNC_ENGINE_MODULE_NAME,
} from './native-sync-engine.constants';
import {
  loadDefaultOptionalNativeModuleLoader,
  loadOptionalNativeModule,
} from '../native-module-loader/native-module-loader.helpers';
import type {
  CreateNativeSyncEngineParams,
  NativeSyncEngine,
  NativeSyncEngineModule,
  NativeSyncEngineOutcome,
  NativeSyncEngineResult,
  NativeSyncEngineResultMap,
} from './native-sync-engine.types';

// The lazily-required `expo-modules-core` loader and the guarded null lookup live in
// `../native-module-loader`, shared by the ticker, sync-engine, and sync-journal seams.

/**
 * Reads an optional string field off a raw native map without assuming its shape: anything that
 * is not a string — a number, an object, a missing key — becomes `null`, because a mistyped
 * diagnostic must never be stringified into a value the journal or the bridge would store
 * verbatim.
 */
function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Reads a count field off a raw native map: only a finite, non-negative number is trusted; a
 * missing, mistyped, or non-finite answer degrades to 0 rather than propagating a value no
 * caller can reason about.
 */
function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Normalizes one raw native result map into the closed-vocabulary {@link NativeSyncEngineResult}.
 *
 * Every field is coerced defensively because Expo delivers plain dictionaries whose shape the
 * compiler cannot check across the bridge:
 * - a foreign or missing `outcome` collapses to `failed` — an answer this seam cannot name is
 *   "this run did not succeed", never a guessed success;
 * - counts degrade to 0, diagnostics to `null`;
 * - unknown keys are dropped, so the result stays assignable to the declared interface.
 */
export function normalizeNativeSyncEngineResult(
  raw: unknown,
): NativeSyncEngineResult {
  const map = (raw && typeof raw === 'object' ? raw : {}) as NativeSyncEngineResultMap;
  const outcome = readOptionalString(map.outcome) as NativeSyncEngineOutcome | null;

  return {
    outcome: outcome && NATIVE_OUTCOMES.includes(outcome) ? outcome : 'failed',
    cycleId: readOptionalString(map.cycleId),
    syncedCount: readCount(map.syncedCount),
    backlogReadCount: readCount(map.backlogReadCount),
    stage: readOptionalString(map.stage),
    errorName: readOptionalString(map.errorName),
    recoveredProcessingCount: readCount(map.recoveredProcessingCount),
    recoveredAbandonedCycleId: readOptionalString(map.recoveredAbandonedCycleId),
  };
}

/**
 * Process-wide flag slot backing the engine-unavailable warning. The flag lives on `globalThis`
 * rather than in a module-level binding because this repo's role-file-shape rule allows a
 * `.helpers` file to declare only types and functions; a `globalThis` key still guarantees the
 * warning fires at most once per JS runtime (a background task runs in the app's own runtime).
 */
type NativeEngineWarningFlags = Record<string, boolean | undefined>;

/**
 * Emits a single per-process `console.warn` naming that the native engine is unavailable and the
 * caller falls back to the JS cycle. Background tasks can construct the seam repeatedly, so the
 * flag is checked and set on `globalThis` before warning; the emit itself is wrapped in try/catch
 * because this runs inside a background task in environments (headless JS runtimes, test
 * sandboxes) where the console surface may be missing or partial — a diagnostic must never be
 * able to throw into the caller.
 */
function warnNativeEngineUnavailable(): void {
  const flagKey = '__autoreasNativeSyncEngineUnavailableWarned';
  const flags = globalThis as unknown as NativeEngineWarningFlags;

  if (flags[flagKey]) {
    return;
  }

  flags[flagKey] = true;

  try {
    console.warn(
      '[sync-engine] Native SyncEngine module is unavailable; falling back to the JS sync cycle.',
    );
  } catch {
    // Swallowing is intentional: this warning is best-effort diagnostics only.
  }
}

/**
 * Builds the result the seam reports whenever no native engine exists on the host: outcome
 * `unavailable`, nothing synced, nothing claimed, no diagnostics — the exact shape callers
 * already handle, so the degraded path needs no second result type.
 */
function createUnavailableNativeSyncEngineResult(): NativeSyncEngineResult {
  return {
    outcome: 'unavailable',
    cycleId: null,
    syncedCount: 0,
    backlogReadCount: 0,
    stage: null,
    errorName: null,
    recoveredProcessingCount: 0,
    recoveredAbandonedCycleId: null,
  };
}

/**
 * Creates the JS-side seam over the native sync-engine module. When the native module is
 * unavailable (Expo Go, iOS, or a non-prebuilt binary) this degrades to an engine that answers
 * `unavailable` instead of crashing or throwing — the background task's caller treats that as
 * the signal to fall back to the existing JS cycle. Even over a present module, `runOnce` still
 * guards rejections: the native side guarantees it never rejects, but a bridge-level failure
 * must still resolve as a failed attempt rather than reject into the task callback.
 */
export function createNativeSyncEngine(
  params: CreateNativeSyncEngineParams = {},
): NativeSyncEngine {
  const loadModule =
    params.requireOptionalNativeModule ??
    loadDefaultOptionalNativeModuleLoader<NativeSyncEngineModule>();
  const nativeModule = loadOptionalNativeModule(loadModule, NATIVE_SYNC_ENGINE_MODULE_NAME);

  if (!nativeModule) {
    warnNativeEngineUnavailable();

    return {
      runOnce: () => Promise.resolve(createUnavailableNativeSyncEngineResult()),
      isAvailable: () => false,
    };
  }

  return {
    runOnce(triggerSource: string): Promise<NativeSyncEngineResult> {
      return nativeModule
        .runOnce(triggerSource)
        .then(normalizeNativeSyncEngineResult)
        .catch((error: unknown) => ({
          ...normalizeNativeSyncEngineResult(null),
          outcome: 'failed' as const,
          errorName: error instanceof Error ? error.name : null,
        }));
    },

    isAvailable(): boolean {
      return true;
    },
  };
}
