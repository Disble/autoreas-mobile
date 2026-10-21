import type { ComponentProps } from 'react';
import type { BottomSheet } from 'heroui-native';

/** Defines the data contract for the app's bottom sheet content: HeroUI's props plus the open state. */
export type SheetContentProps = ComponentProps<typeof BottomSheet.Content> & {
  /** Whether the sheet is open; only a closed sheet is moved after a rotation. */
  readonly isOpen: boolean;
};

/** Defines the data contract for the invisible closed-position keeper inside a sheet. */
export interface ClosedSheetResyncProps {
  readonly isOpen: boolean;
}
