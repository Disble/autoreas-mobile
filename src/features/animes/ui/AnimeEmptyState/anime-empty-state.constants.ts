import type { AnimePseudoDayFilter } from '../../anime.types';

export const DEFAULT_WEEKDAY_ICON = 'calendar-outline';

export const PSEUDO_DAY_ICONS: Readonly<Record<AnimePseudoDayFilter, string>> = {
  'Sin ver': 'time-outline',
  'Ver hoy': 'sparkles-outline',
  Visto: 'checkmark-done-outline',
};

export const PSEUDO_DAY_MESSAGES: Readonly<Record<AnimePseudoDayFilter, string>> = {
  'Sin ver': 'No hay estrenos sin ver.',
  'Ver hoy': 'No hay estrenos para ver hoy.',
  Visto: 'No hay estrenos marcados como vistos.',
};

export const WEEKDAY_EMPTY_STATE_HINT =
  'Cuando Bridge sincronice animes para este día van a aparecer acá.';

export const PSEUDO_DAY_EMPTY_STATE_HINT =
  'Probá con otro día o refrescá la sincronización manual.';
