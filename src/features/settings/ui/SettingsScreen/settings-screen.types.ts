import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { BridgeConfig } from '../../../../infrastructure/db/schema';
import type { LayoutMode } from '../../../../hooks/use-responsive-layout';
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

export interface SettingsScreenViewModel {
  readonly backgroundSyncSection: BackgroundSyncSection;
  readonly config: BridgeConfig | null;
  readonly error: string | null;
  readonly isConfigured: boolean;
  readonly isUnpairing: boolean;
  readonly layoutMode: LayoutMode;
  readonly themeColorForeground: string;
  readonly themeColorMuted: string;
  readonly themeColorSuccess: string;
  readonly themeColorWarning: string;
  readonly themeColorDanger: string;
  readonly handleGoToSetup: () => void;
  readonly handleRePair: () => void;
}

export interface SettingsBridgeCardProps {
  readonly config: BridgeConfig | null;
  readonly isConfigured: boolean;
  readonly isUnpairing: boolean;
  readonly layoutMode: LayoutMode;
  readonly themeColorForeground: string;
  readonly themeColorMuted: string;
  readonly themeColorSuccess: string;
  readonly handleGoToSetup: () => void;
  readonly handleRePair: () => void;
}

export interface SettingsSyncCardProps {
  readonly colors: ResolvedToneColors;
  readonly layoutMode: LayoutMode;
  readonly section: BackgroundSyncSection;
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
