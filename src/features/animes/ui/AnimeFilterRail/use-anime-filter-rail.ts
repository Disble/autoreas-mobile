import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { LayoutChangeEvent, ScrollViewInstance } from 'react-native';
import type { AnimeDayFilter } from '../../anime.types';
import { buildAnimeFilterRailItems, computeRailScrollOffset } from './anime-filter-rail.helpers';
import type { AnimeFilterRailChipLayout, AnimeFilterRailProps } from './anime-filter-rail.types';

/**
 * Coordinates anime filter rail state and actions. The horizontal rail scrolls by itself so the
 * active filter sits centered: on its first measurement without animation, then on every change.
 */
export function useAnimeFilterRail(props: AnimeFilterRailProps) {
  const { onSelect, options, counts, selected, today, orientation } = props;

  // 1. Refs
  const scrollRef = useRef<ScrollViewInstance>(null);
  const chipLayoutsRef = useRef<Partial<Record<AnimeDayFilter, AnimeFilterRailChipLayout>>>({});
  const viewportWidthRef = useRef(0);
  const hasCenteredRef = useRef(false);

  // 5. Derived State (useMemo)
  const items = useMemo(
    () => buildAnimeFilterRailItems({ options, counts, selected, today }),
    [options, counts, selected, today],
  );

  // 6. Callbacks
  const handleSelect = useCallback(
    (value: AnimeDayFilter) => {
      onSelect(value);
    },
    [onSelect],
  );

  const scrollToSelected = useCallback(
    (animated: boolean) => {
      const chip = chipLayoutsRef.current[selected];
      if (!chip || viewportWidthRef.current === 0) {
        return;
      }
      scrollRef.current?.scrollTo({
        x: computeRailScrollOffset(chip, viewportWidthRef.current),
        animated,
      });
      hasCenteredRef.current = true;
    },
    [selected],
  );

  const handleViewportLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportWidthRef.current = event.nativeEvent.layout.width;
      if (!hasCenteredRef.current) {
        scrollToSelected(false);
      }
    },
    [scrollToSelected],
  );

  const handleChipLayout = useCallback(
    (value: AnimeDayFilter, layout: AnimeFilterRailChipLayout) => {
      chipLayoutsRef.current[value] = layout;
      if (value === selected && !hasCenteredRef.current) {
        scrollToSelected(false);
      }
    },
    [scrollToSelected, selected],
  );

  // 7. Effects
  useEffect(() => {
    if (orientation === 'horizontal' && hasCenteredRef.current) {
      scrollToSelected(true);
    }
  }, [orientation, scrollToSelected]);

  return {
    items,
    orientation,
    scrollRef,
    handleChipLayout,
    handleSelect,
    handleViewportLayout,
  };
}
