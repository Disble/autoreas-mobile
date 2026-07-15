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

/** Defines the data contract for vertical rail row props. */
export interface VerticalRailRowProps {
  readonly item: AnimeFilterRailItem;
  readonly onSelect: (value: AnimeFilterRailItem['value']) => void;
}
