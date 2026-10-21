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

/**
 * Counter feedback after a chapter change: the count lifts 1 pt and turns accent, peaking at 40 %
 * of 300 ms, so the answer to a press is drawn on the card itself instead of a toast.
 */
export const COUNT_BUMP = { durationMs: 300, liftPt: 1, peakAt: 0.4 } as const;

/** Plus-button feedback after a chapter is added: a 1.12 scale pulse peaking at 40 % of 320 ms. */
export const PLUS_PULSE = { durationMs: 320, scale: 1.12, peakAt: 0.4 } as const;
