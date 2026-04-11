import { ANIME_PSEUDO_DAY_FILTERS } from '../../anime.constants';
import type { AnimePseudoDayFilter } from '../../anime.types';
import type {
  AnimeFilterRailItem,
  BuildAnimeFilterRailItemsInput,
} from './anime-filter-rail.types';

const PSEUDO_DAY_SET: ReadonlySet<AnimePseudoDayFilter> = new Set(ANIME_PSEUDO_DAY_FILTERS);

/**
 * Projects the raw filter options into rail items enriched with counts, selection, and today flag.
 * Keeps the rail view purely declarative by resolving all display metadata up-front and exposes
 * section-break hints so the rail can visually group weekdays and pseudo-day filters.
 */
export function buildAnimeFilterRailItems(
  input: BuildAnimeFilterRailItemsInput,
): AnimeFilterRailItem[] {
  let firstPseudoDayMarked = false;

  return input.options.map((option) => {
    const isPseudoDay = PSEUDO_DAY_SET.has(option.value as AnimePseudoDayFilter);
    const isFirstPseudoDay = isPseudoDay && !firstPseudoDayMarked;
    if (isFirstPseudoDay) {
      firstPseudoDayMarked = true;
    }

    return {
      value: option.value,
      label: option.label,
      count: input.counts[option.value] ?? 0,
      isToday: option.value === input.today,
      isSelected: option.value === input.selected,
      isPseudoDay,
      isFirstPseudoDay,
    };
  });
}
