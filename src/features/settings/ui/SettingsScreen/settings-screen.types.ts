import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { BridgeConfig } from '../../../../infrastructure/db/schema';
import type { LayoutMode } from '../../../../hooks/use-responsive-layout';
import type { SyncVisibleStatus } from '../../../sync/sync-visible-status.types';
import type { SyncRuntimeStatusSnapshot } from '../../../sync/sync-runtime-status.types';

export type SettingsScreenProps = Record<never, never>;

export type BackgroundSyncSectionTone =
  | 'default'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger';

export type MetricTileTone = BackgroundSyncSectionTone;

export type MetricTileIconName = ComponentProps<typeof Ionicons>['name'];

export type MetricTileSpan = 'half' | 'full';

export interface MetricTile {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tone: MetricTileTone;
  readonly iconName: MetricTileIconName;
  readonly span?: MetricTileSpan;
}

export interface ResolvedToneColors {
  readonly foreground: string;
  readonly muted: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
}

export interface BackgroundSyncSection {
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly statusTone: BackgroundSyncSectionTone;
  readonly tiles: readonly MetricTile[];
}

export interface BuildBackgroundSyncSectionInput {
  readonly isConfigured: boolean;
  readonly snapshot: SyncRuntimeStatusSnapshot;
}

export type SettingsSyncSummaryActionKind = 'go_to_setup' | 'repair_bridge';

export type SettingsBridgeStatusKind =
  | 'unpaired'
  | 'healthy'
  | 'syncing'
  | 'phone_offline'
  | 'bridge_unreachable'
  | 'local_only'
  | 'pending_backlog'
  | 'stale_backlog';

export interface SettingsSyncSummary extends SyncVisibleStatus {
  readonly bridgeStatusKind: SettingsBridgeStatusKind;
  readonly actionKind: SettingsSyncSummaryActionKind | null;
  readonly actionLabel: string | null;
}

export interface SettingsBridgeStatus extends SyncVisibleStatus {
  readonly bridgeStatusKind: SettingsBridgeStatusKind;
}

export interface BuildSettingsSyncSummaryInput {
  readonly isConfigured: boolean;
  readonly isDeviceOnline: boolean | null;
  readonly now: Date;
  readonly syncFacts: {
    readonly connectionStatus: 'idle' | 'syncing' | 'online' | 'offline' | 'error';
    readonly lastSyncAt: number | null;
    readonly pendingOpsCount: number;
    readonly syncError: string | null;
  };
}

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

export interface SettingsSyncCardProps {
  readonly colors: ResolvedToneColors;
  readonly handleSummaryAction: (() => void) | null;
  readonly layoutMode: LayoutMode;
  readonly section: BackgroundSyncSection;
  readonly summary: SettingsSyncSummary;
}

export interface SettingsMetricTileProps {
  readonly tile: MetricTile;
  readonly colors: ResolvedToneColors;
}

export interface SettingsMetricTileGridProps {
  readonly tiles: readonly MetricTile[];
  readonly columns: number;
  readonly colors: ResolvedToneColors;
}
