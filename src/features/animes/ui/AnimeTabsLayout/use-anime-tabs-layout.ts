import { useThemeColor } from 'heroui-native';
import { useMemo } from 'react';
import { Platform } from 'react-native';
import { useAppTheme } from '../../../../contexts/app-theme-context';
import type {
  AnimeTabsLayoutProps,
  AnimeTabsLayoutViewModel,
} from './anime-tabs-layout.types';

export function useAnimeTabsLayout(
  _props: AnimeTabsLayoutProps,
): AnimeTabsLayoutViewModel {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const { isDark } = useAppTheme();
  const [themeColorForeground, themeColorBackground] = useThemeColor([
    'foreground',
    'background',
  ]);

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)
  const headerBackgroundColor = useMemo(
    () =>
      Platform.select({
        ios: undefined,
        android: themeColorBackground,
      }),
    [themeColorBackground]
  );

  // 6. Callbacks (useCallback calling pure helpers)

  // 7. Effects

  return {
    headerBackgroundColor,
    isDark,
    themeColorBackground,
    themeColorForeground,
  };
}
