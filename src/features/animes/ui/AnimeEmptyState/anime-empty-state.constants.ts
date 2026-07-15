import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { AnimePseudoDayFilter } from '../../anime.types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** Provides the shared default weekday icon value. */

export const DEFAULT_WEEKDAY_ICON: IoniconName = 'calendar-outline';

/** Provides the shared pseudo day icons value. */

export const PSEUDO_DAY_ICONS: Readonly<Record<AnimePseudoDayFilter, IoniconName>> = {
  'Sin ver': 'time-outline',
  'Ver hoy': 'sparkles-outline',
  Visto: 'checkmark-done-outline',
};

/** Provides the shared pseudo day messages value. */

export const PSEUDO_DAY_MESSAGES: Readonly<Record<AnimePseudoDayFilter, string>> = {
  'Sin ver': 'No hay estrenos sin ver.',
  'Ver hoy': 'No hay estrenos para ver hoy.',
  Visto: 'No hay estrenos marcados como vistos.',
};

/** Provides the shared weekday empty state hint value. */

export const WEEKDAY_EMPTY_STATE_HINT =
  'Cuando Bridge sincronice animes para este día van a aparecer acá.';

/** Provides the shared pseudo day empty state hint value. */

export const PSEUDO_DAY_EMPTY_STATE_HINT =
  'Probá con otro día o refrescá la sincronización manual.';
