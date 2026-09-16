import type { AnimeListScreenSyncTone } from './anime-list-screen.types';

/** Provides the shared anime list screen refresh label value. */
export const ANIME_LIST_SCREEN_REFRESH_LABEL = 'Refrescar Mis Animes';
/** Provides the shared anime list screen tablet landscape columns value. */
export const ANIME_LIST_SCREEN_TABLET_LANDSCAPE_COLUMNS = 2;
/**
 * Grid cell share for the tablet landscape columns: exactly 1 / ANIME_LIST_SCREEN_TABLET_LANDSCAPE_COLUMNS.
 * A fixed share (not flex-1) keeps the lone card of an odd last row at column width instead of
 * stretching it across the whole row. The `px-2` replaces `columnWrapperClassName="gap-4"`: two
 * neighboring cells each contribute 8dp toward the gap between them (reproducing the old 16dp),
 * while a lone last-row cell still gets its own 8dp inset instead of sitting flush against the
 * row edge -- that inset is what kept an odd last card 8dp wider than its paired siblings.
 * Change it together with the column count.
 */
export const ANIME_LIST_SCREEN_TABLET_LANDSCAPE_CELL_CLASS_NAME = 'flex-[0.5] px-2';
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
