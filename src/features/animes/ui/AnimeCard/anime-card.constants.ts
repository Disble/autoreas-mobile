import type { AnimeStateChipDescriptor } from './anime-card.types';

/** Separates the segments of the meta line's accessible label, the string a screen reader speaks. */
export const META_SEPARATOR = ' · ';

/** Separates the drawn segments of the meta line: the round dot of the approved card. */
export const META_DOT_SEPARATOR = ' • ';

/**
 * Horizontal and vertical hit-slop added to a 40 pt button so its touch area reaches 48 pt.
 * A visual size stays at 40 pt; only the reachable area grows.
 */
export const CARD_TOUCH_SLOP = 4;

/** Hit-slop for the 28 pt ellipsis, bringing its touch area to the 44 pt minimum. */
export const CARD_ELLIPSIS_TOUCH_SLOP = 8;

/** Maps persisted anime states to their user-facing labels and tones. */
export const STATE_CHIP_BY_ESTADO: Readonly<Record<number, AnimeStateChipDescriptor>> = {
  0: { label: 'Viendo', tone: 'accent', isDefault: true },
  1: { label: 'Finalizado', tone: 'success', isDefault: false },
  2: { label: 'No me gustó', tone: 'danger', isDefault: false },
  3: { label: 'En pausa', tone: 'warning', isDefault: false },
};
