import type {
  AnimeDayFilter,
  AnimeDayFilterOption,
  AnimePseudoDayFilter,
  AnimeWeekdayFilter,
} from './anime.types';

/** Provides the shared anime weekday filters value. */

export const ANIME_WEEKDAY_FILTERS: readonly AnimeWeekdayFilter[] = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

/** Provides the shared anime pseudo day filters value. */

export const ANIME_PSEUDO_DAY_FILTERS: readonly AnimePseudoDayFilter[] = [
  'Sin ver',
  'Ver hoy',
  'Visto',
];

/** Provides the shared anime day filter options value. */

export const ANIME_DAY_FILTER_OPTIONS: readonly AnimeDayFilterOption[] = [
  ...ANIME_WEEKDAY_FILTERS.map((value) => ({ value, label: value })),
  ...ANIME_PSEUDO_DAY_FILTERS.map((value) => ({ value, label: value })),
];

/** Provides the shared weekday index to filter value. */

export const WEEKDAY_INDEX_TO_FILTER: Readonly<Record<number, AnimeWeekdayFilter>> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
};

/** Provides the shared anime day filter labels value. */

export const ANIME_DAY_FILTER_LABELS: Readonly<Record<AnimeDayFilter, string>> = {
  Lunes: 'Lunes',
  Martes: 'Martes',
  'Miércoles': 'Miércoles',
  Jueves: 'Jueves',
  Viernes: 'Viernes',
  'Sábado': 'Sábado',
  Domingo: 'Domingo',
  'Sin ver': 'Sin ver',
  'Ver hoy': 'Ver hoy',
  Visto: 'Visto',
};
