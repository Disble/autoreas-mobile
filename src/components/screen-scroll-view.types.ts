import type { PropsWithChildren } from 'react';
import type { ScrollViewProps } from 'react-native';
import type { AnimatedProps } from 'react-native-reanimated';

/** Defines the data contract for screen scroll view props. */
export interface ScreenScrollViewProps extends AnimatedProps<ScrollViewProps> {
  readonly className?: string;
  readonly contentContainerClassName?: string;
}

/** Defines the complete screen scroll view input including children. */
export type ScreenScrollViewWithChildrenProps = PropsWithChildren<ScreenScrollViewProps>;
