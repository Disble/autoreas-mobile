import { useThemeColor } from 'heroui-native';
import { useResponsiveLayout } from '../../../../hooks/use-responsive-layout';
import type { SettingsScreenThemeResult } from './settings-screen.types';

/**
 * Resolves the theme colors and responsive layout mode the Settings screen renders with.
 * Extracted as a facade hook (per the project's Facade Hook pattern) so `useSettingsScreen`
 * stays under its complexity and line budget.
 */
export function useSettingsScreenTheme(): SettingsScreenThemeResult {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const [
    themeColorForeground,
    themeColorMuted,
    themeColorSuccess,
    themeColorWarning,
    themeColorDanger,
  ] = useThemeColor([
    'foreground',
    'muted',
    'success',
    'warning',
    'danger',
  ]);
  const { layout: layoutMode } = useResponsiveLayout();

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)

  // 6. Callbacks (useCallback calling pure helpers)

  // 7. Effects

  return {
    themeColorForeground,
    themeColorMuted,
    themeColorSuccess,
    themeColorWarning,
    themeColorDanger,
    layoutMode,
  };
}
