import type { ThemeColor } from 'heroui-native';
import type { AnimeEstadoDefinition, AnimeStateSheetTone } from './anime-state-sheet.types';

/** Provides the shared anime state sheet title value. */

export const ANIME_STATE_SHEET_TITLE = 'Cambiar estado';

/** Provides the shared tone label class value. */

export const TONE_LABEL_CLASS: Readonly<Record<AnimeStateSheetTone, string>> = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/**
 * Maps each tone to a HeroUI theme token instead of a literal hex value.
 * Resolving through the theme keeps sheet icons aligned with light/dark mode,
 * which hardcoded colors silently broke.
 */
export const TONE_THEME_COLOR: Readonly<Record<AnimeStateSheetTone, ThemeColor>> = {
  default: 'muted',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

/** Declares the tone order used to batch-resolve theme colors in the sheet hook. */
export const TONE_RESOLUTION_ORDER: readonly AnimeStateSheetTone[] = [
  'default',
  'success',
  'warning',
  'danger',
];

/**
 * Legacy-aligned order used by the state sheet so Viendo is the primary action and
 * No me gustó is the destructive outlier at the bottom.
 */
export const ANIME_ESTADO_OPTIONS: readonly AnimeEstadoDefinition[] = [
  {
    value: 0,
    label: 'Viendo',
    description: 'Actualmente en seguimiento',
    icon: 'play-circle-outline',
    tone: 'default',
  },
  {
    value: 1,
    label: 'Finalizado',
    description: 'Lo vi completo',
    icon: 'checkmark-circle-outline',
    tone: 'success',
  },
  {
    value: 3,
    label: 'En pausa',
    description: 'Puesto en espera',
    icon: 'pause-circle-outline',
    tone: 'warning',
  },
  {
    value: 2,
    label: 'No me gustó',
    description: 'Lo dropeé',
    icon: 'close-circle-outline',
    tone: 'danger',
  },
];
