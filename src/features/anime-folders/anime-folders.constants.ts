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
export const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;

/**
 * Letters of non-latin scripts (Greek, Cyrillic, Hebrew, Arabic, Thai, kana, CJK, Hangul). A
 * normalized key keeps only `a-z0-9`, so a name with these would collapse to its digits and match
 * an unrelated folder; such names match by exact name only. The katakana middle dot `・` (U+30FB)
 * is punctuation and stays out of the set.
 */
export const NON_LATIN_LETTER_PATTERN =
  /[\u0370-\u03ff\u0400-\u04ff\u0590-\u06ff\u0e00-\u0e7f\u3040-\u30fa\u30fc-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/;

/** Everything a normalized folder key drops: punctuation, spaces and symbols. */
export const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]/g;

/** Index state before any root is known. */
export const INITIAL_ANIME_FOLDERS_INDEX_STATE: AnimeFoldersIndexState = {
  rootUri: null,
  status: 'idle',
  index: null,
  indexedAt: null,
};
