import {
  deriveVisibleSyncStatus,
  formatLastSyncRecency,
  isManualSyncAvailableNow,
} from '../../../sync/sync-visible-status.helpers';
import type { SyncVisibleStatusFacts } from '../../../sync/sync-visible-status.types';
import {
  SETTINGS_STATUS_ACTION_LABELS,
  SETTINGS_STATUS_META_SEPARATOR,
} from './settings-screen.constants';
import type {
  BuildSettingsSyncSummaryInput,
  SettingsIconName,
  SettingsStatusAction,
  SettingsSyncSummary,
} from './settings-screen.types';

/** Picks the status icon in the same precedence the shared visible status uses for its copy. */
function resolveStatusIconName(facts: SyncVisibleStatusFacts): SettingsIconName {
  if (facts.isBridgeConfigured === false) {
    return 'link-outline';
  }

  if (facts.connectionStatus === 'syncing') {
    return 'sync-outline';
  }

  if (facts.connectionStatus === 'online' && facts.pendingOpsCount === 0) {
    return 'checkmark-circle-outline';
  }

  if (facts.connectionStatus === 'sync_error') {
    return 'alert-circle-outline';
  }

  if (facts.isDeviceOnline === false) {
    return 'cloud-offline-outline';
  }

  return 'desktop-outline';
}

/**
 * Builds the meta line, only while changes are waiting: with nothing pending, the shared
 * description already says when the last sync happened, so repeating it would be noise.
 */
function buildStatusMeta(facts: SyncVisibleStatusFacts, now: Date): string | null {
  if (facts.isBridgeConfigured === false || facts.pendingOpsCount === 0) {
    return null;
  }

  const recency = formatLastSyncRecency(facts.lastSyncAt, now);
  const parts = recency ? [`Último sync ${recency}`] : [];
  parts.push(`${facts.pendingOpsCount} por enviar`);

  return parts.join(SETTINGS_STATUS_META_SEPARATOR);
}

/**
 * Picks the one contextual action: pairing while no PC is paired, otherwise a manual sync that is
 * hidden while a sync runs and disabled while it cannot start. Re-pairing is never offered here:
 * a PC that is merely off does not need a new pairing.
 */
function resolveStatusAction(facts: SyncVisibleStatusFacts): SettingsStatusAction | null {
  if (facts.isBridgeConfigured === false) {
    return { kind: 'go_to_setup', label: SETTINGS_STATUS_ACTION_LABELS.goToSetup, isDisabled: false };
  }

  if (facts.connectionStatus === 'syncing') {
    return null;
  }

  const isRetry = facts.pendingOpsCount > 0 || facts.connectionStatus === 'sync_error';

  return {
    kind: 'sync_now',
    label: isRetry ? SETTINGS_STATUS_ACTION_LABELS.retry : SETTINGS_STATUS_ACTION_LABELS.syncNow,
    isDisabled: !isManualSyncAvailableNow(facts),
  };
}

/**
 * Builds the Settings status card from the shared local-first visible status: its title,
 * description and tone, plus the icon, the meta line and the single contextual action.
 */
export function buildSettingsSyncSummary({
  isConfigured,
  isDeviceOnline,
  now,
  syncFacts,
}: BuildSettingsSyncSummaryInput): SettingsSyncSummary {
  const facts: SyncVisibleStatusFacts = {
    ...syncFacts,
    isBridgeConfigured: isConfigured,
    isDeviceOnline,
  };

  return {
    ...deriveVisibleSyncStatus(facts, now),
    iconName: resolveStatusIconName(facts),
    meta: buildStatusMeta(facts, now),
    action: resolveStatusAction(facts),
  };
}
