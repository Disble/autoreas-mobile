import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { AnimePseudoDayFilter } from '../../anime.types';

/** Provides the Ionicons glyph names used by the anime empty state. */
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
  'Sin ver': 'No hay estrenos pendientes esta temporada.',
  'Ver hoy': 'Hoy no hay estrenos para ver.',
  Visto: 'Todavía no viste ningún estreno esta temporada.',
};

/** Provides the shared weekday empty state hint value. */

export const WEEKDAY_EMPTY_STATE_HINT =
  'Cuando Bridge sincronice animes para este día, aparecerán aquí.';

/**
 * Explains each empty premiere stage. The three filters are stages a premiere moves through during
 * the season, not days, so an empty one is normal and never points the user at another day or a sync.
 */
export const PSEUDO_DAY_EMPTY_STATE_HINTS: Readonly<Record<AnimePseudoDayFilter, string>> = {
  'Sin ver': 'Ya viste todos o todavía no se agregaron estrenos.',
  'Ver hoy': 'Día libre: nada en la lista de hoy.',
  Visto: 'Los estrenos que termines aparecerán aquí.',
};
