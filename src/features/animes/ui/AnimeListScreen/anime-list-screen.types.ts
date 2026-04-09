import type { Href } from 'expo-router';
import type { Anime } from '../../../../infrastructure/validation/anime-schema';
import type { AnimeTab } from '../../anime.types';

export type AnimeListScreenProps = Record<never, never>;

export interface AnimeListScreenViewModel {
  readonly animes: Anime[];
  readonly isMutatingAnimeById: Readonly<Record<string, boolean>>;
  readonly isDark: boolean;
  readonly isEmpty: boolean;
  readonly settingsHref: Href;
  readonly tab: AnimeTab;
  readonly themeColorForeground: string;
  readonly handleCapMinus: (animeId: string) => void;
  readonly handleCapPlus: (animeId: string) => void;
  readonly handleOpenSettings: () => void;
  readonly handleTabChange: (value: string) => void;
}
