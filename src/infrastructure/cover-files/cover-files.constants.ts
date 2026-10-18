import type { CoverManifest } from './cover-files.types';

/** Provides the shared covers directory name value, resolved under `Paths.document`. */
export const COVERS_DIRECTORY_NAME = 'covers';

/**
 * Provides the inbox directory name, resolved under `Paths.document`. The native background sync
 * (`SyncEngineCoverPrefetch`) downloads covers here as `<name>.jpg` + `<name>.json` pairs, and the
 * cover store adopts each complete pair into `covers/`. Mirrors `COVER_INBOX_DIRECTORY_NAME` in
 * `SyncEngineBackgroundCatchUp.kt`.
 */
export const COVER_INBOX_DIRECTORY_NAME = 'covers-inbox';

/** Provides the shared cover manifest file name value. */
export const COVER_MANIFEST_FILE_NAME = 'manifest.json';

/** Provides the shared cover manifest temp file name value, used by the write-then-move sequence. */
export const COVER_MANIFEST_TEMP_FILE_NAME = 'manifest.json.tmp';

/** Provides the empty v1 manifest returned for a missing, invalid, or wrong-version input. */
export const EMPTY_COVER_MANIFEST: CoverManifest = Object.freeze({
  version: 1,
  entries: Object.freeze({}),
});
