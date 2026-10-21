import type { ThemeColor } from 'heroui-native';
import type { SyncVisibleStatusKind } from '../../../sync/sync-visible-status.types';
import type { AnimeListScreenVisibleSyncStatus } from '../AnimeListScreen/anime-list-screen.types';

/** What the bar button draws for a sync state: a tinted dot, or an icon when no sync can run. */
export type SyncStatusGlyph = 'dot' | 'wifi-off' | 'device';

/** Defines how one sync state kind is drawn in the bar button. */
export interface SyncStatusIndicator {
  readonly glyph: SyncStatusGlyph;
  readonly color: ThemeColor;
  readonly isBreathing: boolean;
}

/** Defines the indicator for every sync state kind. */
export type SyncStatusIndicatorByKind = Readonly<Record<SyncVisibleStatusKind, SyncStatusIndicator>>;

/** Defines the data contract for sync status button props. */
export interface SyncStatusButtonProps {
  readonly status: AnimeListScreenVisibleSyncStatus;
  readonly onPress: () => void;
}

/** Defines the data contract for sync status dot props. */
export interface SyncStatusDotProps {
  readonly color: string;
  readonly isBreathing: boolean;
}

/** Defines the data contract for sync status glyph props. */
export interface SyncStatusGlyphProps {
  readonly status: AnimeListScreenVisibleSyncStatus;
}

/** Defines the data contract for sync status sheet props. */
export interface SyncStatusSheetProps {
  readonly isOpen: boolean;
  readonly isManualSyncEnabled: boolean;
  readonly status: AnimeListScreenVisibleSyncStatus;
  readonly onAction: () => void;
  readonly onClose: () => void;
  readonly onSyncNow: () => Promise<void>;
}

/** Defines one full-width action of the sync status sheet. */
export interface SyncStatusSheetAction {
  readonly key: 'action' | 'sync-now';
  readonly label: string;
  readonly variant: 'primary' | 'secondary';
  readonly onPress: () => void;
}

/** Defines the data contract for the sync status alert props. */
export interface SyncStatusAlertProps {
  readonly status: AnimeListScreenVisibleSyncStatus;
  readonly onAction: () => void;
}
