import type { AnimeListScreenSyncTone } from './anime-list-screen.types';

/** Provides the shared anime list screen refresh label value. */
export const ANIME_LIST_SCREEN_REFRESH_LABEL = 'Refrescar Mis Animes';
/** Provides the shared anime list screen tablet landscape columns value. */
export const ANIME_LIST_SCREEN_TABLET_LANDSCAPE_COLUMNS = 3;
/** Provides the shared anime list screen sync settings action label value. */
export const ANIME_LIST_SCREEN_SYNC_SETTINGS_ACTION_LABEL = 'Revisar bridge';
/** Provides the shared anime list screen sync pair action label value. */
export const ANIME_LIST_SCREEN_SYNC_PAIR_ACTION_LABEL = 'Emparejar bridge';

/** Provides the shared anime list screen sync chip color by tone value. */
export const ANIME_LIST_SCREEN_SYNC_CHIP_COLOR_BY_TONE: Record<
  AnimeListScreenSyncTone,
  'default' | 'accent' | 'success' | 'warning' | 'danger'
> = {
  default: 'default',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};


/** Maps pseudo-day filters to contextual header titles. */
export const PSEUDO_DAY_TITLE: Readonly<Record<string, string>> = {
  'Ver hoy': 'Para ver hoy',
  'Sin ver': 'Sin ver',
  Visto: 'Vistos',
};

/** Provides compact Spanish weekday labels by JavaScript day index. */
export const SHORT_WEEKDAY_BY_INDEX: readonly string[] = [
  'Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb',
];

/** Provides compact Spanish month labels by JavaScript month index. */
export const SHORT_MONTH_BY_INDEX: readonly string[] = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];
