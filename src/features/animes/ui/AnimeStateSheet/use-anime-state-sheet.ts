import { useCallback, useMemo } from 'react';
import { buildAnimeStateSheetOptions } from './anime-state-sheet.helpers';
import type { AnimeStateSheetProps } from './anime-state-sheet.types';

export function useAnimeStateSheet(props: AnimeStateSheetProps) {
  // 1. Refs
  // 2. State
  // 3. Context/3rd Party Hooks
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
    visible: props.visible,
    options,
    handleSelect,
    handleClose,
  };
}
