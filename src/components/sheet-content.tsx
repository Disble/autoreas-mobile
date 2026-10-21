import { BottomSheet } from 'heroui-native';
import { useClosedSheetResync } from '../hooks/use-closed-sheet-resync';
import type { ClosedSheetResyncProps, SheetContentProps } from './sheet-content.types';

/**
 * Renders `BottomSheet.Content` for every app sheet, keeping a closed sheet off screen after a
 * rotation. Use it in place of `BottomSheet.Content`, with the sheet's `isOpen`.
 */
export function SheetContent(props: Readonly<SheetContentProps>) {
  const { children, isOpen, ...contentProps } = props;

  return (
    <BottomSheet.Content {...contentProps}>
      <ClosedSheetResync isOpen={isOpen} />
      {children}
    </BottomSheet.Content>
  );
}

/** Draws nothing; it runs the closed-position reaction from inside the sheet's context. */
function ClosedSheetResync({ isOpen }: Readonly<ClosedSheetResyncProps>) {
  useClosedSheetResync(isOpen);

  return null;
}
