import type {
  AnimeFilterRailItem,
  BuildAnimeFilterRailItemsInput,
} from './anime-filter-rail.types';

/**
 * Projects the raw filter options into rail items enriched with counts, selection, and today flag.
 * Keeps the rail view purely declarative by resolving all display metadata up-front.
 */
export function buildAnimeFilterRailItems(
  input: BuildAnimeFilterRailItemsInput,
): AnimeFilterRailItem[] {
  return input.options.map((option) => ({
    value: option.value,
    label: option.label,
    count: input.counts[option.value] ?? 0,
    isToday: option.value === input.today,
    isSelected: option.value === input.selected,
  }));
}
