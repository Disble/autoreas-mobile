import type { AnimeFolderBannerCopy } from './anime-folder-banner.types';

/** Copy of the feature hint shown until a root is chosen or the hint is dismissed. */
export const ANIME_FOLDER_HINT_COPY: AnimeFolderBannerCopy = {
  title: 'Abre la carpeta de cada anime desde la tablet',
  description: 'Elige una vez dónde guardas los animes. Autoreas solo lee los nombres de las carpetas.',
};

/** Copy shown when the chosen root can no longer be read. */
export const ANIME_FOLDER_LOST_COPY: AnimeFolderBannerCopy = {
  title: 'No se puede leer la carpeta de anime',
  description:
    'La tarjeta SD no está o Android quitó el permiso. Los botones de carpeta vuelven cuando la elijas de nuevo.',
};
