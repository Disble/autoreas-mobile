import { useThemeColor } from 'heroui-native';
import { createElement, useMemo } from 'react';
import { Platform } from 'react-native';
import { ThemeToggle } from '../../../../components/theme-toggle';
import { useAppTheme } from '../../../../contexts/app-theme-context';
import type {
  AnimeTabsLayoutProps,
  AnimeTabsLayoutScreenOptions,
  AnimeTabsLayoutViewModel,
} from './anime-tabs-layout.types';

/** Coordinates anime tabs layout state and actions. */
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

  // React Navigation calls `headerRight` as a plain function inside its own
  // header hook, so the toggle is handed over as one prebuilt element: passing
  // `ThemeToggle` itself would run its hooks inside that call.
  const headerRight = useMemo(() => {
    const themeToggle = createElement(ThemeToggle);

    return () => themeToggle;
  }, []);

  const screenOptions = useMemo<AnimeTabsLayoutScreenOptions>(
    () => ({
      contentStyle: {
        backgroundColor: themeColorBackground,
      },
      gestureDirection: 'horizontal',
      gestureEnabled: true,
      headerBackButtonDisplayMode: 'generic',
      headerBlurEffect: isDark ? 'dark' : 'light',
      headerRight,
      headerStyle: {
        backgroundColor: headerBackgroundColor,
      },
      headerTintColor: themeColorForeground,
      headerTitleAlign: 'center',
      headerTitleStyle: {
        fontFamily: 'Inter-SemiBold',
      },
      headerTransparent: true,
    }),
    [
      headerBackgroundColor,
      headerRight,
      isDark,
      themeColorBackground,
      themeColorForeground,
    ]
  );

  const settingsScreenOptions = useMemo<AnimeTabsLayoutScreenOptions>(
    () => ({
      headerTitle: 'Configuración',
    }),
    []
  );

  // 6. Callbacks (useCallback calling pure helpers)

  // 7. Effects

  return {
    screenOptions,
    settingsScreenOptions,
  };
}
