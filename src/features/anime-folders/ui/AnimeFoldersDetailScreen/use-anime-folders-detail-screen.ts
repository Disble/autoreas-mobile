import { useMemo } from 'react';
import { useResponsiveLayout } from '../../../../hooks/use-responsive-layout';
import { useAnimeFolderResolution } from '../../use-anime-folder-resolution';
import { useAnimeFolders } from '../../use-anime-folders';
import { ANIME_FOLDERS_SETTINGS_COPY } from '../AnimeFoldersSettingsCard/anime-folders-settings-card.constants';
import { buildAnimeFoldersDetailView } from './anime-folders-detail-screen.helpers';

/** Feeds the read-only folder detail screen from the shared index and resolution. */
export function useAnimeFoldersDetailScreen() {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const { status, rootLabel } = useAnimeFolders();
  const resolution = useAnimeFolderResolution();
  const { layout } = useResponsiveLayout();

  // 4. Queries/Mutations

  // 5. Derived State
  const summary = resolution?.summary ?? null;
  const view = useMemo(
    () => (summary && status !== 'lost' ? buildAnimeFoldersDetailView(summary) : null),
    [summary, status],
  );
  const statusLabel =
    status === 'lost' ? ANIME_FOLDERS_SETTINGS_COPY.unreadable : ANIME_FOLDERS_SETTINGS_COPY.searching;

  // 6. Callbacks

  // 7. Effects

  return { rootLabel, view, statusLabel, isWide: layout === 'tablet-landscape' };
}
