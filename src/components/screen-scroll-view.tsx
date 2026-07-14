import { cn } from 'heroui-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useHeaderHeight from '../helpers/hooks/use-header-height';
import { AnimatedScreenScrollView } from './screen-scroll-view.constants';
import type { ScreenScrollViewWithChildrenProps } from './screen-scroll-view.types';

/** Renders a scrollable screen with safe-area and header spacing. */
export function ScreenScrollView(props: Readonly<ScreenScrollViewWithChildrenProps>) {
  const { children, className, contentContainerClassName, ...scrollViewProps } = props;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  return (
    <AnimatedScreenScrollView
      className={cn('bg-background', className)}
      contentContainerClassName={cn('px-5', contentContainerClassName)}
      contentContainerStyle={{
        paddingTop: headerHeight,
        paddingBottom: insets.bottom + 32,
      }}
      showsVerticalScrollIndicator={false}
      {...scrollViewProps}
    >
      {children}
    </AnimatedScreenScrollView>
  );
}
