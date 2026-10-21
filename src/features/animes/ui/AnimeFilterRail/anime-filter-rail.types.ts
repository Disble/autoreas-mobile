import type { AnimeDayFilter, AnimeDayFilterOption } from '../../anime.types';

/** Defines the anime filter rail orientation value shape. */
export type AnimeFilterRailOrientation = 'horizontal' | 'vertical';

/** Defines the data contract for anime filter rail item. */
export interface AnimeFilterRailItem {
  readonly value: AnimeDayFilter;
  readonly label: string;
  readonly count: number;
  readonly isToday: boolean;
  readonly isSelected: boolean;
  readonly isPseudoDay: boolean;
  readonly isFirstPseudoDay: boolean;
}

/** Defines the data contract for anime filter rail props. */
export interface AnimeFilterRailProps {
  readonly options: readonly AnimeDayFilterOption[];
  readonly counts: Readonly<Record<string, number>>;
  readonly selected: AnimeDayFilter;
  readonly today: AnimeDayFilter;
  readonly orientation: AnimeFilterRailOrientation;
  readonly onSelect: (value: AnimeDayFilter) => void;
}

/** Defines the data contract for build anime filter rail items input. */
export interface BuildAnimeFilterRailItemsInput {
  readonly options: readonly AnimeDayFilterOption[];
  readonly counts: Readonly<Record<string, number>>;
  readonly selected: AnimeDayFilter;
  readonly today: AnimeDayFilter;
}

/** Defines the measured x offset and width of one horizontal rail chip. */
export interface AnimeFilterRailChipLayout {
  readonly x: number;
  readonly width: number;
}

/** Defines the data contract for one rail entry: the item and the rail's select and layout handlers. */
export interface AnimeFilterRailEntryProps {
  readonly item: AnimeFilterRailItem;
  readonly onSelect: (value: AnimeFilterRailItem['value']) => void;
  readonly onChipLayout?: (value: AnimeFilterRailItem['value'], layout: AnimeFilterRailChipLayout) => void;
}
