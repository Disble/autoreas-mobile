import type { AnimeListScreenSyncTone } from './anime-list-screen.types';

export const ANIME_LIST_SCREEN_REFRESH_LABEL = 'Refrescar Mis Animes';
export const ANIME_LIST_SCREEN_TABLET_LANDSCAPE_COLUMNS = 3;
export const ANIME_LIST_SCREEN_SYNC_SETTINGS_ACTION_LABEL = 'Revisar bridge';
export const ANIME_LIST_SCREEN_SYNC_PAIR_ACTION_LABEL = 'Emparejar bridge';

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
