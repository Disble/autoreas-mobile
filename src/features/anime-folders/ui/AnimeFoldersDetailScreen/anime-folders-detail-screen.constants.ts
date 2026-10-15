import type { FolderMatchMethod } from '../../anime-folders.types';

/** Copy of the read-only "Carpetas de anime" detail screen (canvas 08). */
export const ANIME_FOLDERS_DETAIL_COPY = {
  rootSection: 'EN ESTA TABLET',
  foldersTotal: 'carpetas',
  withAnimeTotal: 'con anime',
  withoutAnimeTotal: 'sin anime',
  scanNote:
    'Busca hasta 3 niveles de carpetas; por ejemplo, One Pace - Wano está dentro de One Pace - Whole Cake Island. Ignora las carpetas ocultas (.stfolder, .data…), los archivos sueltos y las subcarpetas de una carpeta que ya tiene anime, como Mini Episodes.',
  unmatchedHint:
    'Ningún anime de la PC usa una carpeta con este nombre. Si debería tener uno, revisa su carpeta en Autoreas Bridge.',
  sharedHint:
    'Si dos animes comparten el nombre de una carpeta, aparecen aquí y ninguno muestra el botón hasta que se distinga en la PC.',
  none: 'Ninguna.',
} as const;

/** Stack header of the detail screen; a constant so the header options keep one identity. */
export const ANIME_FOLDERS_DETAIL_SCREEN_OPTIONS = { headerTitle: 'Carpetas de anime' } as const;

/**
 * Badge of how each folder was matched. Only "nombre exacto" is canvas copy; the other two are
 * assumed wording for the bridge path and the normalized name steps.
 */
export const FOLDER_MATCH_METHOD_LABEL: Readonly<Record<FolderMatchMethod, string>> = {
  path: 'ruta de la PC',
  exact: 'nombre exacto',
  normalized: 'nombre parecido',
};
