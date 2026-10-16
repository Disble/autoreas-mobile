import type { AnimeFolderSource, AnimeFoldersIndexState } from './anime-folders.types';

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

/**
 * Where the system folder picker opens: the tablet's `SD card › Videos › Anime` (verified via adb).
 * When that folder does not exist, Android opens the picker at its default location instead.
 */
export const ANIME_FOLDERS_INITIAL_URI =
  'content://com.android.externalstorage.documents/document/0123-4567%3AVideos%2FAnime';

/** Samsung My Files action that opens a folder by absolute path. */
export const SAMSUNG_MY_FILES_LAUNCH_ACTION = 'samsung.myfiles.intent.action.LAUNCH_MY_FILES';

/** Extra that carries the absolute folder path for My Files. */
export const SAMSUNG_MY_FILES_START_PATH_EXTRA = 'samsung.myfiles.intent.extra.START_PATH';

/** `Intent.FLAG_ACTIVITY_NEW_TASK`; required for LAUNCH_ADJACENT to take effect. */
export const FLAG_ACTIVITY_NEW_TASK = 0x10000000;

/** `Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT`; in split screen, opens in the other half. */
export const FLAG_ACTIVITY_LAUNCH_ADJACENT = 0x00001000;

/** An http(s) url with a host; anything else (e.g. `descargado`) has no page to open. */
export const OPENABLE_PAGE_URL_PATTERN = /^https?:\/\/[^\s/?#]+/i;

/** Alert title when My Files could not open the folder. */
export const OPEN_FOLDER_FAILED_TITLE = 'No se pudo abrir la carpeta';

/** Alert title when the browser could not open the anime page. */
export const OPEN_PAGE_FAILED_TITLE = 'No se pudo abrir la página';

/** Stable empty fallback for the anime live query, so the resolution memo is not rebuilt each render. */
export const EMPTY_ANIME_FOLDER_SOURCES: readonly AnimeFolderSource[] = [];

/** Name of the native folder lister in modules/saf-lister. */
export const SAF_LISTER_MODULE_NAME = 'SafLister';
