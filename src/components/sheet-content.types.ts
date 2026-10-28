import type { ComponentProps } from 'react';
import type { BottomSheet } from 'heroui-native';
import type { ViewProps } from 'react-native';

/**
 * Defines the data contract for the app's bottom sheet content: HeroUI's props plus the open state.
 * `onAccessibilityEscape` is listed explicitly because React Native 0.88's `AccessibilityProps`, which
 * the sheet's props extend, no longer includes it.
 */
export type SheetContentProps = ComponentProps<typeof BottomSheet.Content> &
  Pick<ViewProps, 'onAccessibilityEscape'> & {
  /** Whether the sheet is open; only a closed sheet is moved after a rotation. */
  readonly isOpen: boolean;
};

/** Defines the data contract for the invisible closed-position keeper inside a sheet. */
export interface ClosedSheetResyncProps {
  readonly isOpen: boolean;
}
