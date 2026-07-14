import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { BridgeConfig } from '../../../../infrastructure/db/schema';
import type { LayoutMode } from '../../../../hooks/responsive-layout.types';
import type { SyncVisibleStatus } from '../../../sync/sync-visible-status.types';
import type { SyncRuntimeStatusSnapshot } from '../../../sync/sync-runtime-status.types';
import type { SyncConnectionStatus } from '../../../sync/sync-connection-store/sync-connection-store.types';

/** Defines the settings screen props value shape. */
export type SettingsScreenProps = Record<never, never>;

/** Defines the background sync section tone value shape. */
export type BackgroundSyncSectionTone =
  | 'default'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger';

/** Defines the metric tile icon name value shape. */
export type MetricTileIconName = ComponentProps<typeof Ionicons>['name'];

/** Defines the metric tile span value shape. */
export type MetricTileSpan = 'half' | 'full';

/** Defines the data contract for metric tile. */
export interface MetricTile {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tone: BackgroundSyncSectionTone;
  readonly iconName: MetricTileIconName;
  readonly span?: MetricTileSpan;
}

/** Defines the data contract for resolved tone colors. */
export interface ResolvedToneColors {
  readonly foreground: string;
  readonly muted: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
}

/** Defines the data contract for background sync section. */
export interface BackgroundSyncSection {
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly statusTone: BackgroundSyncSectionTone;
  readonly tiles: readonly MetricTile[];
}

/** Defines the data contract for build background sync section input. */
export interface BuildBackgroundSyncSectionInput {
  readonly isConfigured: boolean;
  readonly snapshot: SyncRuntimeStatusSnapshot;
}

/** Defines the settings sync summary action kind value shape. */
export type SettingsSyncSummaryActionKind = 'go_to_setup' | 'repair_bridge';

/** Defines the settings bridge status kind value shape. */
export type SettingsBridgeStatusKind =
  | 'unpaired'
  | 'healthy'
  | 'syncing'
  | 'phone_offline'
  | 'bridge_unreachable'
  | 'sync_error'
  | 'local_only'
  | 'pending_backlog'
  | 'stale_backlog';

/** Defines the data contract for settings sync summary. */
export interface SettingsSyncSummary extends SyncVisibleStatus {
  readonly bridgeStatusKind: SettingsBridgeStatusKind;
  readonly actionKind: SettingsSyncSummaryActionKind | null;
  readonly actionLabel: string | null;
}

/** Defines the data contract for settings bridge status. */
export interface SettingsBridgeStatus extends SyncVisibleStatus {
  readonly bridgeStatusKind: SettingsBridgeStatusKind;
}

/** Defines the data contract for build settings sync summary input. */
export interface BuildSettingsSyncSummaryInput {
  readonly isConfigured: boolean;
  readonly isDeviceOnline: boolean | null;
  readonly now: Date;
  readonly syncFacts: {
    readonly connectionStatus: SyncConnectionStatus;
    readonly lastSyncAt: number | null;
    readonly pendingOpsCount: number;
    readonly syncError: string | null;
  };
}

/** Defines the data contract for settings screen view model. */
export interface SettingsScreenViewModel {
  readonly backgroundSyncSection: BackgroundSyncSection;
  readonly bridgeStatus: SettingsBridgeStatus;
  readonly config: BridgeConfig | null;
  readonly error: string | null;
  readonly isConfigured: boolean;
  readonly isUnpairing: boolean;
  readonly layoutMode: LayoutMode;
  readonly syncSummary: SettingsSyncSummary;
  readonly themeColorForeground: string;
  readonly themeColorMuted: string;
  readonly themeColorSuccess: string;
  readonly themeColorWarning: string;
  readonly themeColorDanger: string;
  readonly handleGoToSetup: () => void;
  readonly handleRePair: () => void;
  readonly handleSyncSummaryAction: (() => void) | null;
}

/** Defines the data contract for settings bridge card props. */
export interface SettingsBridgeCardProps {
  readonly bridgeStatus: SettingsBridgeStatus;
  readonly config: BridgeConfig | null;
  readonly isConfigured: boolean;
  readonly isUnpairing: boolean;
  readonly layoutMode: LayoutMode;
  readonly themeColorForeground: string;
  readonly themeColorMuted: string;
  readonly handleGoToSetup: () => void;
  readonly handleRePair: () => void;
}

/** Defines the data contract for settings sync card props. */
export interface SettingsSyncCardProps {
  readonly colors: ResolvedToneColors;
  readonly handleSummaryAction: (() => void) | null;
  readonly layoutMode: LayoutMode;
  readonly section: BackgroundSyncSection;
  readonly summary: SettingsSyncSummary;
}

/** Defines the data contract for settings metric tile props. */
export interface SettingsMetricTileProps {
  readonly tile: MetricTile;
  readonly colors: ResolvedToneColors;
}

/** Defines the data contract for settings metric tile grid props. */
export interface SettingsMetricTileGridProps {
  readonly tiles: readonly MetricTile[];
  readonly columns: number;
  readonly colors: ResolvedToneColors;
}
