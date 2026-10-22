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
/**
 * FlatList rendering budget. With `numColumns` FlatList counts ROWS, not cards. A row is one card of
 * about 150 dp (the cover column follows the text, plus the 12 dp `mb-3`), so a phone shows about 4
 * rows, a tablet in landscape about 5 (10 cards) and a tablet in portrait about 8: 8 rows fill the
 * first screen on every layout without mounting the default 10.
 */
export const ANIME_LIST_SCREEN_INITIAL_ROWS_TO_RENDER = 8;
/**
 * Viewports kept mounted: the visible one plus two above and two below (the default is 21). Cards are
 * heavy (cover, Reanimated controls), so a smaller window keeps fewer of them alive and re-rendering.
 */
export const ANIME_LIST_SCREEN_WINDOW_SIZE = 5;
/** Rows mounted per batch while scrolling (default 10): small batches keep each frame short. */
export const ANIME_LIST_SCREEN_MAX_ROWS_PER_BATCH = 4;
/** Provides the shared anime list screen sync settings action label value. */
export const ANIME_LIST_SCREEN_SYNC_SETTINGS_ACTION_LABEL = 'Revisar conexión';
/** Provides the shared anime list screen sync pair action label value. */
export const ANIME_LIST_SCREEN_SYNC_PAIR_ACTION_LABEL = 'Emparejar PC';

/** Width of each fixed side column of the bar, by layout: wide enough for two 44 pt buttons. */
export const ANIME_LIST_SCREEN_HEADER_SIDE_WIDTH = { phone: 96, tablet: 240 } as const;
/** Horizontal inset the native bar keeps at each edge, subtracted from the title's room. */
export const ANIME_LIST_SCREEN_HEADER_EDGE_INSET = 16;

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
