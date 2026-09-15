import type { CoverManifest } from './cover-files.types';

/** Provides the shared covers directory name value, resolved under `Paths.document`. */
export const COVERS_DIRECTORY_NAME = 'covers';

/** Provides the shared cover manifest file name value. */
export const COVER_MANIFEST_FILE_NAME = 'manifest.json';

/** Provides the shared cover manifest temp file name value, used by the write-then-move sequence. */
export const COVER_MANIFEST_TEMP_FILE_NAME = 'manifest.json.tmp';

/** Provides the empty v1 manifest returned for a missing, invalid, or wrong-version input. */
export const EMPTY_COVER_MANIFEST: CoverManifest = Object.freeze({
  version: 1,
  entries: Object.freeze({}),
});
