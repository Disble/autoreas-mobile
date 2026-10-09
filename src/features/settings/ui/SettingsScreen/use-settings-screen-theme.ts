import { useThemeColor } from 'heroui-native';
import { useMemo } from 'react';
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
  const [accent, foreground, muted, success, warning, danger] = useThemeColor([
    'accent',
    'foreground',
    'muted',
    'success',
    'warning',
    'danger',
  ]);
  const { layout: layoutMode } = useResponsiveLayout();

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)
  const toneColors = useMemo(
    () => ({ accent, foreground, muted, success, warning, danger }),
    [accent, danger, foreground, muted, success, warning],
  );

  // 6. Callbacks (useCallback calling pure helpers)

  // 7. Effects

  return { toneColors, layoutMode };
}
