import type { AnimeEstadoDefinition, AnimeStateSheetTone } from './anime-state-sheet.types';

/** Provides the shared anime state sheet title value. */

export const ANIME_STATE_SHEET_TITLE = 'Cambiar estado';

/** Colors each option's dot with the role of its state, the same tones the card uses. */
export const TONE_DOT_CLASS: Readonly<Record<AnimeStateSheetTone, string>> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/**
 * Legacy-aligned order used by the state sheet so Viendo is the primary action and
 * No me gustó is the destructive outlier at the bottom.
 */
export const ANIME_ESTADO_OPTIONS: readonly AnimeEstadoDefinition[] = [
  { value: 0, label: 'Viendo', tone: 'accent' },
  { value: 1, label: 'Finalizado', tone: 'success' },
  { value: 3, label: 'En pausa', tone: 'warning' },
  { value: 2, label: 'No me gustó', tone: 'danger' },
];
