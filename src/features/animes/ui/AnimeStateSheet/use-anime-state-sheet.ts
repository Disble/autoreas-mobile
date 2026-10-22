import { useThemeColor } from 'heroui-native';
import { useCallback, useMemo } from 'react';
import { buildAnimeStateSheetOptions } from './anime-state-sheet.helpers';
import type { AnimeStateSheetProps } from './anime-state-sheet.types';

/** Coordinates anime state sheet state and actions. */
export function useAnimeStateSheet(props: AnimeStateSheetProps) {
  // 1. Refs
  // 2. State
  // 3. Context/3rd Party Hooks
  const [checkColor] = useThemeColor(['accent']);

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)
  const options = useMemo(
    () => buildAnimeStateSheetOptions(props.currentEstado),
    [props.currentEstado],
  );

  // 6. Callbacks
  const handleSelect = useCallback(
    (estado: number) => {
      props.onSelect(estado);
      props.onClose();
    },
    [props],
  );

  const handleClose = useCallback(() => {
    props.onClose();
  }, [props]);

  // 7. Effects

  return {
    isOpen: props.visible,
    animeTitle: props.animeTitle,
    options,
    checkColor,
    handleSelect,
    handleClose,
  };
}
