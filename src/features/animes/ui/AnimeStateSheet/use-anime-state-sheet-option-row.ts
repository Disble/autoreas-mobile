import { useCallback, useMemo } from 'react';
import type { AnimeStateSheetOptionRowProps } from './anime-state-sheet.types';

/** Resolves one state option row's selection state and press handler. */
export function useAnimeStateSheetOptionRow(props: AnimeStateSheetOptionRowProps) {
  const { option, onSelect } = props;

  // 5. Derived State
  const accessibilityState = useMemo(() => ({ checked: option.isSelected }), [option.isSelected]);

  // 6. Callbacks
  const handlePress = useCallback(() => {
    onSelect(option.value);
  }, [onSelect, option.value]);

  return { accessibilityState, handlePress };
}
