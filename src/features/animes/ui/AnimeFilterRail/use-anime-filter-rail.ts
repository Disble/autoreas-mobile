import { useCallback, useMemo } from 'react';
import type { AnimeDayFilter } from '../../anime.types';
import { buildAnimeFilterRailItems } from './anime-filter-rail.helpers';
import type { AnimeFilterRailProps } from './anime-filter-rail.types';

/** Coordinates anime filter rail state and actions. */
export function useAnimeFilterRail(props: AnimeFilterRailProps) {
  // 1. Refs
  // 2. State
  // 3. Context/3rd Party Hooks
  // 4. Queries/Mutations

  // 5. Derived State (useMemo)
  const items = useMemo(
    () =>
      buildAnimeFilterRailItems({
        options: props.options,
        counts: props.counts,
        selected: props.selected,
        today: props.today,
      }),
    [props.options, props.counts, props.selected, props.today],
  );

  const orientation = props.orientation;

  // 6. Callbacks
  const handleSelect = useCallback(
    (value: AnimeDayFilter) => {
      props.onSelect(value);
    },
    [props],
  );

  // 7. Effects

  return {
    items,
    orientation,
    handleSelect,
  };
}
