import { SYNC_STATUS_INDICATOR_BY_KIND } from './sync-status-control.constants';
import type { SyncStatusIndicator } from './sync-status-control.types';
import type { AnimeListScreenVisibleSyncStatus } from '../AnimeListScreen/anime-list-screen.types';

/** Resolves how the bar button draws the given sync status. */
export function deriveSyncStatusIndicator(
  status: Pick<AnimeListScreenVisibleSyncStatus, 'kind'>,
): SyncStatusIndicator {
  return SYNC_STATUS_INDICATOR_BY_KIND[status.kind];
}

/**
 * Decides whether the status earns an alert above the list. Only a rejected send and a backlog
 * stale past the 72 h threshold ask for attention; every other state lives in the bar button.
 */
export function shouldShowSyncStatusAlert(
  status: Pick<AnimeListScreenVisibleSyncStatus, 'kind'>,
): boolean {
  return status.kind === 'rejected' || status.kind === 'stale';
}

/** Returns the title as a second line only when it says something the chip label does not. */
export function deriveSyncStatusSecondLine(
  status: Pick<AnimeListScreenVisibleSyncStatus, 'chipLabel' | 'title'>,
): string | null {
  return status.title === status.chipLabel ? null : status.title;
}

/** Builds the bar button's accessibility label from the status chip. */
export function buildSyncStatusAccessibilityLabel(
  status: Pick<AnimeListScreenVisibleSyncStatus, 'chipLabel'>,
): string {
  return `Sincronización: ${status.chipLabel}`;
}
