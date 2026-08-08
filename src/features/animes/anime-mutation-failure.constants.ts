/**
 * Caps the persisted failure message so the Settings "Ultimo fallo" tile stays readable.
 * The full stack never reaches this channel on purpose: the tile is a diagnosis pointer, not a log.
 */
export const ANIME_MUTATION_FAILURE_MAX_MESSAGE_LENGTH = 300;

/** Stands in for a thrown value that carries no usable message. */
export const ANIME_MUTATION_FAILURE_UNKNOWN_REASON = 'Error desconocido';

/** Toast label shown when a local chapter mutation could not be written. */
export const ANIME_MUTATION_FAILURE_LABEL = 'No se pudo guardar el capitulo';

/** Toast label shown when the local database is not ready to accept writes. */
export const ANIME_MUTATION_STORAGE_UNAVAILABLE_LABEL = 'Almacenamiento no disponible';

/** Toast description shown when the local database is not ready to accept writes. */
export const ANIME_MUTATION_STORAGE_UNAVAILABLE_DESCRIPTION =
  'La base local todavia no esta lista. Reinicia la app e intenta de nuevo.';
