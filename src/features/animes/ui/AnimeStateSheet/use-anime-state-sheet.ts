import BottomSheet, { BottomSheetBackdrop, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { createElement, useCallback, useEffect, useMemo, useRef } from 'react';
import { buildAnimeStateSheetOptions } from './anime-state-sheet.helpers';
import type { AnimeStateSheetProps } from './anime-state-sheet.types';

/** Coordinates anime state sheet state and actions. */
export function useAnimeStateSheet(props: AnimeStateSheetProps) {
  // 1. Refs
  const sheetRef = useRef<BottomSheet>(null);
  // 2. State
  // 3. Context/3rd Party Hooks
  // 4. Queries/Mutations

  // 5. Derived State (useMemo)
  const snapPoints = useMemo(() => ['45%'], []);
  const renderBackdrop = useMemo(
    () =>
      function Backdrop(backdropProps: BottomSheetBackdropProps) {
        return createElement(BottomSheetBackdrop, {
          ...backdropProps,
          appearsOnIndex: 0,
          disappearsOnIndex: -1,
          pressBehavior: 'close',
        });
      },
    [],
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
  useEffect(() => {
    if (props.visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [props.visible]);

  return {
    sheetRef,
    snapPoints,
    renderBackdrop,
    visible: props.visible,
    options,
    handleSelect,
    handleClose,
  };
}
