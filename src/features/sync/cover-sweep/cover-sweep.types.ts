import type { SQLiteDatabase } from 'expo-sqlite';
import type { BridgeAnimeCoverResult, BridgeClient } from '../../../infrastructure/api';
import type { BridgeConfig } from '../../../infrastructure/db/schema';
import type { CoverManifest } from '../../../infrastructure/cover-files';

/** Clock seam for the cover sweep's timing decisions, mirroring the season-rating-queue clock. */
export interface CoverSweepClock {
  readonly now: () => number;
}

/**
 * One active anime's identity plus the normalized `portada` (see `normalizeCoverSourceKey`) its
 * cover manifest entry must be resolved against. `selectCoverSweepTargets` compares this
 * `sourceKey` against each entry's own to detect a changed cover that a stale `nextAttemptAt`
 * would otherwise hide.
 */
export interface CoverActiveAnimeSource {
  readonly animeId: string;
  readonly sourceKey: string | null;
}

/**
 * Outcome fed into `shouldStopCoverSweep`: either a classified bridge cover result, or a caught
 * error from the `getAnimeCover` call (so a network failure can be judged by the same function
 * as a normal HTTP outcome).
 */
export type CoverSweepOutcome =
  | BridgeAnimeCoverResult
  | { readonly kind: 'error'; readonly error: unknown };

/**
 * Injectable collaborators for `hydrateCoverUris` / `runCoverSweep`. Production defaults
 * (`DEFAULT_COVER_SWEEP_DEPENDENCIES`) wire the real bridge client, the `expo-file-system` disk
 * adapter, and the `cover-uri-store`; tests inject fakes for every member so no test touches a
 * real filesystem or network.
 */
export interface CoverSweepDependencies {
  readonly clock: CoverSweepClock;
  readonly bridgeClient: Pick<BridgeClient, 'getAnimeCover'>;
  readonly readManifest: () => Promise<CoverManifest>;
  readonly writeManifest: (manifest: CoverManifest) => Promise<void>;
  readonly writeCoverImage: (fileName: string, bytes: Uint8Array) => Promise<string>;
  readonly coverFileExists: (fileName: string) => Promise<boolean>;
  readonly deleteCoverFile: (fileName: string) => Promise<void>;
  readonly listCoverFileNames: () => Promise<readonly string[]>;
  readonly getCoverFileUri: (fileName: string) => string;
  readonly publishCoverUris: (coverUriByAnimeId: Readonly<Record<string, string>>) => void;
  readonly readActiveAnimeCoverSources: (
    rawDb: SQLiteDatabase,
  ) => Promise<readonly CoverActiveAnimeSource[]>;
  readonly getBridgeConfigSnapshot: (rawDb: SQLiteDatabase) => Promise<BridgeConfig | null>;
}

/** Summary `runCoverSweep` resolves with once one pass over the active animes completes. */
export interface CoverSweepSummary {
  readonly fetched: number;
  readonly notModified: number;
  readonly absent: number;
  readonly unknown: number;
  readonly transient: number;
  readonly stopped: boolean;
}
