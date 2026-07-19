import { useThemeColor } from 'heroui-native';
import { useCallback, useMemo } from 'react';
import {
  TONE_RESOLUTION_ORDER,
  TONE_THEME_COLOR,
} from './anime-state-sheet.constants';
import { buildAnimeStateSheetOptions, buildToneIconColorMap } from './anime-state-sheet.helpers';
import type { AnimeStateSheetProps } from './anime-state-sheet.types';

/** Coordinates anime state sheet state and actions. */
export function useAnimeStateSheet(props: AnimeStateSheetProps) {
  // 1. Refs
  // 2. State
  // 3. Context/3rd Party Hooks
  const resolvedToneColors = useThemeColor(
    TONE_RESOLUTION_ORDER.map((tone) => TONE_THEME_COLOR[tone]),
  );

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)
  const toneIconColors = useMemo(
    () => buildToneIconColorMap(TONE_RESOLUTION_ORDER, resolvedToneColors),
    [resolvedToneColors],
  );

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
    options,
    toneIconColors,
    selectedIconColor: toneIconColors.success,
    handleSelect,
    handleClose,
  };
}
