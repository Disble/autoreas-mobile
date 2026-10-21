import { useBottomSheetInternal } from '@gorhom/bottom-sheet';
import { useAnimatedReaction } from 'react-native-reanimated';
import { CLOSED_SHEET_RESYNC } from './closed-sheet-resync.constants';
import { shouldResyncClosedSheet } from './closed-sheet-resync.helpers';

/**
 * Keeps a closed bottom sheet below the screen when the screen changes size (a rotation, a
 * split-screen resize). HeroUI keeps every closed sheet mounted, and the gorhom sheet under it does
 * not move a closed sheet when its closed position changes: rotating a tablet from landscape to
 * portrait left each closed sheet parked at the old landscape height, its top half over the list.
 * gorhom cannot tell it is closed any more: it derives the index from the stale position, which the
 * new, taller container reads as open. So the open state comes from HeroUI (`isOpen`): when the
 * closed position changes while the sheet is closed and not moving, this reaction (on the UI
 * thread, inside the sheet) moves it there at once, the same way gorhom's own `close()` does.
 * An open or moving sheet is left to gorhom. Outside a sheet (tests) the context is null and it
 * does nothing.
 */
export function useClosedSheetResync(isOpen: boolean): void {
  // 3. Context/3rd Party Hooks
  const sheet = useBottomSheetInternal(true);

  // 7. Effects
  useAnimatedReaction(
    () => sheet?.animatedDetentsState.get().closedDetentPosition,
    (closedPosition, previousClosedPosition) => {
      if (
        sheet === null ||
        closedPosition === undefined ||
        !shouldResyncClosedSheet({
          closedPosition,
          previousClosedPosition,
          isOpen,
          animationStatus: sheet.animatedAnimationState.get().status,
        })
      ) {
        return;
      }
      sheet.animateToPosition(
        closedPosition,
        CLOSED_SHEET_RESYNC.animationSource,
        0,
        CLOSED_SHEET_RESYNC.animation,
      );
    },
    [isOpen, sheet],
  );
}
