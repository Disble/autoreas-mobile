import type { AnimeEstadoDefinition, AnimeStateSheetTone } from './anime-state-sheet.types';

/** Provides the shared anime state sheet title value. */

export const ANIME_STATE_SHEET_TITLE = 'Cambiar estado';

/** Labels the confirm action that applies the chosen state, the same word the note sheet saves with. */
export const ANIME_STATE_SHEET_CONFIRM_LABEL = 'Guardar';

/**
 * Draws each option's 8 pt dot in the role of its state, the same tones the card uses. Each entry is
 * the whole class string: composing `bg-*` through `cn()` drew no colour on device, while the full
 * static string does.
 */
export const TONE_DOT_CLASS: Readonly<Record<AnimeStateSheetTone, string>> = {
  accent: 'size-2 rounded-full bg-accent',
  success: 'size-2 rounded-full bg-success',
  warning: 'size-2 rounded-full bg-warning',
  danger: 'size-2 rounded-full bg-danger',
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
