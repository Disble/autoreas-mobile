import { useCallback, useMemo } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { buildRailItemAccessibilityLabel } from './anime-filter-rail.helpers';
import type { AnimeFilterRailEntryProps } from './anime-filter-rail.types';

/** Resolves one rail entry's label, selection state, and its press and layout handlers. */
export function useAnimeFilterRailEntry(props: AnimeFilterRailEntryProps) {
  const { item, onSelect, onChipLayout } = props;

  // 5. Derived State
  const accessibilityLabel = buildRailItemAccessibilityLabel(item);
  const accessibilityState = useMemo(() => ({ selected: item.isSelected }), [item.isSelected]);

  // 6. Callbacks
  const handlePress = useCallback(() => {
    onSelect(item.value);
  }, [item.value, onSelect]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { x, width } = event.nativeEvent.layout;
      onChipLayout?.(item.value, { x, width });
    },
    [item.value, onChipLayout],
  );

  return { accessibilityLabel, accessibilityState, handleLayout, handlePress };
}
