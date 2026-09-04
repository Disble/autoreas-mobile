import { useMemo } from 'react';
import { useBackgroundSyncStatus } from '../../use-background-sync-status';
import { buildBackgroundSyncSection } from './settings-screen.helpers';
import type { BackgroundSyncSection } from './settings-screen.types';

/**
 * Resolves the background sync status snapshot and derives the presentation section the
 * Settings screen renders for it. Extracted as a facade hook (per the project's Facade Hook
 * pattern) so `useSettingsScreen` stays under its complexity and line budget.
 */
export function useSettingsScreenBackgroundSyncSection(
  isConfigured: boolean,
): BackgroundSyncSection {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks

  // 4. Queries/Mutations
  const { snapshot } = useBackgroundSyncStatus();

  // 5. Derived State (useMemo)
  const backgroundSyncSection = useMemo(
    () => buildBackgroundSyncSection({ isConfigured, snapshot }),
    [isConfigured, snapshot],
  );

  // 6. Callbacks (useCallback calling pure helpers)

  // 7. Effects

  return backgroundSyncSection;
}
