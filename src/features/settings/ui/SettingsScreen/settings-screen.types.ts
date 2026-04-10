import type { BridgeConfig } from '../../../../infrastructure/db/schema';
import type { SyncRuntimeStatusSnapshot } from '../../../sync/sync-runtime-status.types';

export type SettingsScreenProps = Record<never, never>;

export type BackgroundSyncSectionTone =
  | 'default'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger';

export interface BackgroundSyncRow {
  readonly label: string;
  readonly value: string;
}

export interface BackgroundSyncSection {
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly statusTone: BackgroundSyncSectionTone;
  readonly rows: readonly BackgroundSyncRow[];
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
  readonly themeColorForeground: string;
  readonly themeColorMuted: string;
  readonly handleGoToSetup: () => void;
  readonly handleRePair: () => void;
}
