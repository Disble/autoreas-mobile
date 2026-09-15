import { bridgeClient } from '../../../infrastructure/api/bridge-client/bridge-client-instance.constants';
import {
  coverFileExists,
  deleteCoverFile,
  getCoverFileUri,
  listCoverFileNames,
  readCoverManifest,
  writeCoverImage,
  writeCoverManifest,
} from '../../../infrastructure/cover-files/cover-files.helpers';
import { getBridgeConfigSnapshot } from '../../../infrastructure/db/client/client.helpers';
import { useCoverUriStore } from '../../../infrastructure/store/cover-uri-store/cover-uri-store.constants';
import type { CoverSweepDependencies } from './cover-sweep.types';

/** Revalidation horizon after a conclusive image/not_modified/absent answer (7 days). */
export const COVER_REVALIDATE_MS = 7 * 24 * 60 * 60 * 1000;

/** Recheck horizon after a 404 (unknown anime), shorter than the image horizon so a since-added cover is found sooner. */
export const COVER_UNKNOWN_RECHECK_MS = 24 * 60 * 60 * 1000;

/** Base backoff delay applied to the first transient failure, absent a server `Retry-After`. */
export const COVER_TRANSIENT_BASE_DELAY_MS = 15 * 60 * 1000;

/** Upper bound the exponential transient backoff never exceeds. */
export const COVER_TRANSIENT_MAX_DELAY_MS = 6 * 60 * 60 * 1000;

/** Maximum number of cover requests the sweep runs in flight at once. */
export const COVER_SWEEP_CONCURRENCY = 2;

/**
 * Production collaborators for `hydrateCoverUris` / `runCoverSweep`: the real bridge client, the
 * `expo-file-system`-backed disk adapter, the real `cover-uri-store`, and a plain (non-write-door)
 * read of the active anime ids -- reads never need `withLocalWrite` (see `getBridgeConfigSnapshot`
 * precedent in `client.helpers.ts`).
 */
export const DEFAULT_COVER_SWEEP_DEPENDENCIES: CoverSweepDependencies = {
  clock: { now: Date.now },
  bridgeClient,
  readManifest: readCoverManifest,
  writeManifest: writeCoverManifest,
  writeCoverImage,
  coverFileExists,
  deleteCoverFile,
  listCoverFileNames,
  getCoverFileUri,
  publishCoverUris: (coverUriByAnimeId) => {
    useCoverUriStore.getState().setCoverUris(coverUriByAnimeId);
  },
  readActiveAnimeIds: async (rawDb) => {
    const rows = await rawDb.getAllAsync<{ _id: string }>(
      'SELECT _id FROM animes WHERE activo = 1',
    );

    return rows.map((row) => row._id);
  },
  getBridgeConfigSnapshot,
};
