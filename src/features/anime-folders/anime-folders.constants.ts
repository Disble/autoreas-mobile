import type { AnimeFoldersIndexState } from './anime-folders.types';

/** How many folder levels below the root the index walks. */
export const ANIME_FOLDERS_MAX_DEPTH = 3;

/** Volume id Android uses for the internal shared storage. */
export const PRIMARY_VOLUME_ID = 'primary';

/** Device path of the internal shared storage. */
export const PRIMARY_STORAGE_PATH = '/storage/emulated/0';

/** Breadcrumb label of the internal shared storage. */
export const PRIMARY_VOLUME_LABEL = 'Almacenamiento interno';

/** Breadcrumb label of any removable volume. */
export const REMOVABLE_VOLUME_LABEL = 'SD card';

/** Breadcrumb separator used in root labels. */
export const ROOT_LABEL_SEPARATOR = ' › ';

/** Marker before the tree id in a SAF tree uri. */
export const TREE_SEGMENT = '/tree/';

/** Marker before the document id in a SAF child uri. */
export const DOCUMENT_SEGMENT = '/document/';

/** Combining marks left behind by NFKD, removed so accents do not block a normalized match. */
export const COMBINING_MARKS_PATTERN = /[̀-ͯ]/g;

/** Everything a normalized folder key drops: punctuation, spaces and symbols. */
export const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]/g;

/** Index state before any root is known. */
export const INITIAL_ANIME_FOLDERS_INDEX_STATE: AnimeFoldersIndexState = {
  rootUri: null,
  status: 'idle',
  index: null,
  indexedAt: null,
};
