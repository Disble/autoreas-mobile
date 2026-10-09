import type { ComponentProps } from 'react';
import type { useRouter } from 'expo-router';
import type { Ionicons } from '@expo/vector-icons';
import type { BridgeConfig } from '../../../../infrastructure/db/schema';
import type { LayoutMode } from '../../../../hooks/responsive-layout.types';
import type { SyncVisibleStatus, SyncVisibleStatusTone } from '../../../sync/sync-visible-status.types';
import type { SyncRuntimeStatusSnapshot } from '../../../sync/sync-runtime-status.types';
import type { SyncConnectionStatus } from '../../../sync/sync-connection-store/sync-connection-store.types';
import type { UseSyncFacadeResult } from '../../../sync/sync-facade.types';
import type { useBridgeConfig } from '../../use-bridge-config';

/** Defines the settings screen props value shape. */
export type SettingsScreenProps = Record<never, never>;

/** Defines the icon name value shape the Settings cards render. */
export type SettingsIconName = ComponentProps<typeof Ionicons>['name'];

/** Defines the data contract for the theme colors a tone resolves to. */
export interface ResolvedToneColors {
  readonly accent: string;
  readonly foreground: string;
  readonly muted: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
}

/** Defines the kind of the single contextual action the status card can offer. */
export type SettingsStatusActionKind = 'go_to_setup' | 'sync_now';

/** Defines the data contract for the status card's contextual action. */
export interface SettingsStatusAction {
  readonly kind: SettingsStatusActionKind;
  readonly label: string;
  /** True while the action cannot start right now, e.g. the device has no connection. */
  readonly isDisabled: boolean;
}

/** Defines the data contract for the status card: the shared visible status plus Settings extras. */
export interface SettingsSyncSummary extends SyncVisibleStatus {
  readonly iconName: SettingsIconName;
  /** Short line such as "Último sync hace 9 h · 1 por enviar", or null when it adds nothing. */
  readonly meta: string | null;
  readonly action: SettingsStatusAction | null;
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
  };
}

/** Defines the identifier of one background-sync item that needs the user's attention. */
export type SettingsBackgroundIssueId =
  | 'background_unsupported'
  | 'background_service'
  | 'battery_exemption'
  | 'notification_permission';

/** Defines the kind of fix a background issue offers. */
export type SettingsBackgroundIssueActionKind = 'request_battery_exemption' | 'open_app_settings';

/** Defines the data contract for the fix button of a background issue. */
export interface SettingsBackgroundIssueAction {
  readonly kind: SettingsBackgroundIssueActionKind;
  readonly label: string;
}

/** Defines the data contract for one background-sync item that needs the user's attention. */
export interface SettingsBackgroundIssue {
  readonly id: SettingsBackgroundIssueId;
  readonly title: string;
  readonly description: string;
  readonly action: SettingsBackgroundIssueAction | null;
}

/**
 * Defines what the background card shows: inactive while no PC is paired, one ok line when
 * everything works, or only the failing items otherwise.
 */
export type SettingsBackgroundStatus =
  | { readonly kind: 'inactive' }
  | { readonly kind: 'ok' }
  | { readonly kind: 'needs_attention'; readonly issues: readonly SettingsBackgroundIssue[] };

/** Defines the data contract for build settings background status input. */
export interface BuildSettingsBackgroundStatusInput {
  readonly isConfigured: boolean;
  /** True while the battery exemption is missing on a device that can request it. */
  readonly isBatteryExemptionHighlighted: boolean;
  readonly snapshot: Pick<
    SyncRuntimeStatusSnapshot,
    'registrationStatus' | 'executionMode' | 'canShowPersistentNotification'
  >;
}

/** Defines the data contract for the connection card. */
export interface SettingsConnection {
  readonly host: string;
  readonly deviceId: string;
}

/** Defines the bridge config fields the connection card reads. */
export type SettingsConnectionConfig = Pick<BridgeConfig, 'ip' | 'port' | 'deviceId'>;

/** Defines the result contract for `useSettingsScreenBatteryExemption`. */
export interface UseSettingsScreenBatteryExemptionResult {
  /** True while the exemption is missing on a device that can request it. */
  readonly isBatteryExemptionHighlighted: boolean;
  readonly handleRequestBatteryExemption: () => void;
}

/** Defines the result contract for `useSettingsScreenTheme`. */
export interface SettingsScreenThemeResult {
  readonly toneColors: ResolvedToneColors;
  readonly layoutMode: LayoutMode;
}

/** Defines the result contract for `useSettingsScreenSyncSummary`. */
export interface SettingsScreenSyncSummaryResult
  extends Pick<ReturnType<typeof useBridgeConfig>, 'isConfigured' | 'isUnpairing' | 'error' | 'unpair'> {
  readonly connection: SettingsConnection | null;
  readonly manualSync: UseSyncFacadeResult['manualSync'];
  readonly syncSummary: SettingsSyncSummary;
}

/** Defines the input contract for `useSettingsScreenActions`. */
export interface UseSettingsScreenActionsInput {
  readonly router: ReturnType<typeof useRouter>;
  readonly unpair: ReturnType<typeof useBridgeConfig>['unpair'];
  readonly manualSync: UseSyncFacadeResult['manualSync'];
  readonly statusActionKind: SettingsStatusActionKind | null;
  readonly handleRequestBatteryExemption: () => void;
}

/** Defines the result contract for `useSettingsScreenActions`. */
export interface UseSettingsScreenActionsResult {
  readonly handleRePair: () => void;
  readonly handleStatusAction: (() => void) | null;
  readonly backgroundIssueActionHandlers: SettingsBackgroundIssueActionHandlers;
}

/** Maps each background fix to the handler that performs it. */
export type SettingsBackgroundIssueActionHandlers = Readonly<
  Record<SettingsBackgroundIssueActionKind, () => void>
>;

/** Defines the data contract for settings screen view model. */
export interface SettingsScreenViewModel {
  readonly backgroundStatus: SettingsBackgroundStatus;
  readonly connection: SettingsConnection | null;
  readonly error: string | null;
  readonly isUnpairing: boolean;
  readonly layoutMode: LayoutMode;
  readonly syncSummary: SettingsSyncSummary;
  readonly statusIconColor: string;
  readonly isSyncTelemetryEnabled: boolean;
  readonly handleRePair: () => void;
  readonly handleStatusAction: (() => void) | null;
  readonly backgroundIssueActionHandlers: SettingsBackgroundIssueActionHandlers;
  readonly handleToggleSyncTelemetry: (nextEnabled: boolean) => void;
}

/** Defines the data contract for the status card props. */
export interface SettingsStatusCardProps {
  readonly summary: SettingsSyncSummary;
  readonly iconColor: string;
  readonly handleStatusAction: (() => void) | null;
}

/** Defines the data contract for the connection card props. */
export interface SettingsConnectionCardProps {
  readonly connection: SettingsConnection;
  readonly isUnpairing: boolean;
  readonly handleRePair: () => void;
}

/** Defines the data contract for the background card props. */
export interface SettingsBackgroundCardProps {
  readonly status: SettingsBackgroundStatus;
  readonly backgroundIssueActionHandlers: SettingsBackgroundIssueActionHandlers;
}

/** Defines the data contract for one background issue row props. */
export interface SettingsBackgroundIssueRowProps {
  readonly issue: SettingsBackgroundIssue;
  readonly backgroundIssueActionHandlers: SettingsBackgroundIssueActionHandlers;
}

/** Defines the data contract for the privacy card props. */
export interface SettingsPrivacyCardProps {
  readonly isSyncTelemetryEnabled: boolean;
  readonly handleToggleSyncTelemetry: (nextEnabled: boolean) => void;
}

/** Re-states the shared tone so Settings constants can be keyed by it. */
export type SettingsTone = SyncVisibleStatusTone;
