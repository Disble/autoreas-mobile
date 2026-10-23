import type { AnimeStateChipDescriptor } from './anime-card.types';

/** Separates the segments of the meta line's accessible label, the string a screen reader speaks. */
export const META_SEPARATOR = ' · ';

/** Separates the drawn segments of the meta line: the round dot of the approved card. */
export const META_DOT_SEPARATOR = ' • ';

/**
 * Grows the 18 pt meta line to a 44 pt touch area without adding drawn space, so the line stays 4 pt
 * under the title. The bottom edge stops at 12 pt, where the actions row begins (`gap-3`); the rest
 * of the 26 pt goes above, over the title, which is not pressable.
 */
export const META_TOGGLE_HIT_SLOP = { top: 14, bottom: 12, left: 0, right: 0 } as const;

/** Announces the meta line's toggle; only spoken when there are remaining episodes to switch to. */
export const META_TOGGLE_HINT = 'Alternar episodios restantes';

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

/** Spoken hint on the card title: a long press copies it. */
export const TITLE_COPY_HINT = 'Mantén presionado para copiar el título';

/** Toast shown once the title is on the clipboard. */
export const TITLE_COPIED_LABEL = 'Título copiado';

/** Toast shown when the clipboard refused the title. */
export const TITLE_COPY_FAILED_LABEL = 'No se pudo copiar el título';
