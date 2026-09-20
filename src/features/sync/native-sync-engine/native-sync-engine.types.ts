/**
 * The outcome vocabulary the native engine reports for one background attempt, extended with the
 * seam-only `unavailable` value: a missing native module must be observable without changing the
 * result's shape (docs/mobile-sync-architecture.md 6.7 — three outcomes plus "not applicable").
 * - `closed`         — the attempt ran to its terminal bookkeeping
 * - `failed`         — the attempt ended in a handled failure (rows reverted, error named)
 * - `abandoned`      — the native watchdog ended the attempt at the 30 s budget
 * - `not_applicable` — nothing was claimed: no config, or the lease is held elsewhere
 * - `unavailable`    — seam-only: no native engine module exists on this host
 */
export type NativeSyncEngineOutcome =
  | 'closed'
  | 'failed'
  | 'abandoned'
  | 'not_applicable'
  | 'unavailable';

/**
 * Defines the raw, untyped map the native `runOnce` resolves with. Expo delivers plain
 * dictionaries whose fields cannot be trusted to exist or to have the expected type, so every
 * field is optional and unknown — {@link normalizeNativeSyncEngineResult} owns the coercion.
 */
export type NativeSyncEngineResultMap = {
  readonly outcome?: unknown;
  readonly cycleId?: unknown;
  readonly syncedCount?: unknown;
  readonly backlogReadCount?: unknown;
  readonly stage?: unknown;
  readonly errorName?: unknown;
};

/** Defines the normalized, closed-vocabulary result of one native engine attempt. */
export interface NativeSyncEngineResult {
  /** One of the {@link NativeSyncEngineOutcome} values; a foreign answer collapses to `failed`. */
  readonly outcome: NativeSyncEngineOutcome;
  /** Correlation id of the attempt, or `null` when none was minted (e.g. unavailable). */
  readonly cycleId: string | null;
  /** Operations the bridge confirmed as applied. */
  readonly syncedCount: number;
  /** Deduped backlog rows the attempt read, regardless of outcome. */
  readonly backlogReadCount: number;
  /** The last attempt state the journal reached, or `null` when unknown. */
  readonly stage: string | null;
  /** Error class name when the attempt failed, otherwise `null`. */
  readonly errorName: string | null;
}

/**
 * Defines the raw native module surface exposed by the `SyncEngine` local Expo module. The
 * native side guarantees `runOnce` always RESOLVES within its own 30 s budget — never rejects,
 * never throws — because an unresolved promise is what burns the platform's job budget. The JS
 * seam still guards rejections so a bridge-level failure degrades to a failed attempt.
 */
export interface NativeSyncEngineModule {
  readonly runOnce: (triggerSource: string) => Promise<NativeSyncEngineResultMap>;
}

/** Defines the loader function signature for the optional native engine module lookup. */
export type RequireOptionalNativeModule = (
  moduleName: string,
) => NativeSyncEngineModule | null;

/** Defines the data contract for create native sync engine params. */
export interface CreateNativeSyncEngineParams {
  /** Test seam: overrides the lazy `expo-modules-core` module lookup. */
  readonly requireOptionalNativeModule?: RequireOptionalNativeModule;
}

/**
 * Defines the JS-side seam over the native sync engine. `runOnce` never throws and never
 * rejects: a missing module answers `unavailable`, a native failure answers `failed`, and the
 * caller (the background task) can always map the result onto its two host outcomes.
 */
export interface NativeSyncEngine {
  readonly runOnce: (triggerSource: string) => Promise<NativeSyncEngineResult>;
  readonly isAvailable: () => boolean;
}
