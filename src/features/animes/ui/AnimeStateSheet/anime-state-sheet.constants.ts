import type { AnimeEstadoDefinition, AnimeStateSheetTone } from './anime-state-sheet.types';

export const ANIME_STATE_SHEET_TITLE = 'Cambiar estado';

export const TONE_LABEL_CLASS: Readonly<Record<AnimeStateSheetTone, string>> = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export const TONE_ICON_COLOR: Readonly<Record<AnimeStateSheetTone, string>> = {
  default: '#6B7280',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
};

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
