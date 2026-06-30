import {
  SYNC_VISIBLE_STATUS_STALE_WARNING_HOURS,
} from '../../../sync/sync-visible-status.constants';
import {
  deriveVisibleSyncStatus,
} from '../../../sync/sync-visible-status.helpers';
import type {
  BuildSettingsSyncSummaryInput,
  SettingsBridgeStatus,
  SettingsSyncSummary,
} from './settings-screen.types';

function getDaysSinceTimestamp(timestamp: number | null, now: Date): number | null {
  if (timestamp === null) {
    return null;
  }

  const elapsedMilliseconds = now.getTime() - timestamp;

  if (elapsedMilliseconds <= 0) {
    return 0;
  }

  return Math.floor(elapsedMilliseconds / (24 * 60 * 60 * 1000));
}

function resolveBridgeStatusKind({
  isConfigured,
  isDeviceOnline,
  now,
  syncFacts,
}: BuildSettingsSyncSummaryInput): SettingsSyncSummary['bridgeStatusKind'] {
  if (!isConfigured) {
    return 'unpaired';
  }

  if (syncFacts.connectionStatus === 'syncing') {
    return 'syncing';
  }

  if (syncFacts.connectionStatus === 'online' && syncFacts.pendingOpsCount === 0) {
    return 'healthy';
  }

  if (isDeviceOnline === false) {
    return 'phone_offline';
  }

  if (syncFacts.pendingOpsCount > 0) {
    const daysSinceLastSync = getDaysSinceTimestamp(syncFacts.lastSyncAt, now);
    const isStaleBacklog =
      daysSinceLastSync !== null &&
      daysSinceLastSync * 24 >= SYNC_VISIBLE_STATUS_STALE_WARNING_HOURS;

    return isStaleBacklog ? 'stale_backlog' : 'pending_backlog';
  }

  if (syncFacts.connectionStatus === 'error' || syncFacts.syncError !== null) {
    return 'bridge_unreachable';
  }

  return 'local_only';
}

/**
 * Builds the shared offline-first sync summary for Settings while tagging the bridge-specific state needed by the left card.
 * This keeps the Settings surface aligned with the existing sync-visible-state rules instead of inventing card-local logic.
 */
export function buildSettingsSyncSummary({
  isConfigured,
  isDeviceOnline,
  now,
  syncFacts,
}: BuildSettingsSyncSummaryInput): SettingsSyncSummary {
  const bridgeStatusKind = resolveBridgeStatusKind({
    isConfigured,
    isDeviceOnline,
    now,
    syncFacts,
  });
  const status = deriveVisibleSyncStatus(
    {
      ...syncFacts,
      isBridgeConfigured: isConfigured,
      isDeviceOnline,
    },
    now,
  );

  if (!isConfigured) {
    return {
      ...status,
      bridgeStatusKind,
      actionKind: 'go_to_setup',
      actionLabel: 'Emparejar bridge',
    };
  }

  if (syncFacts.pendingOpsCount > 0 && isDeviceOnline !== false) {
    return {
      ...status,
      bridgeStatusKind,
      actionKind: 'repair_bridge',
      actionLabel: 'Re-emparejar bridge',
    };
  }

  return {
    ...status,
    bridgeStatusKind,
    actionKind: null,
    actionLabel: null,
  };
}

/**
 * Adapts the shared sync summary into bridge-card copy so the left Settings card explains bridge reachability honestly.
 * The card keeps device identity details while this helper supplies the user-facing operational title, chip, and description.
 */
export function buildSettingsBridgeStatus(
  summary: SettingsSyncSummary,
): SettingsBridgeStatus {
  switch (summary.bridgeStatusKind) {
    case 'unpaired':
      return {
        bridgeStatusKind: summary.bridgeStatusKind,
        chipLabel: 'Sin bridge',
        description: 'Todavía no hay un bridge emparejado en esta app.',
        title: 'Sin bridge configurado',
        tone: 'warning',
      };
    case 'healthy':
      return {
        bridgeStatusKind: summary.bridgeStatusKind,
        chipLabel: summary.chipLabel,
        description: summary.description,
        title: 'Bridge disponible ahora',
        tone: summary.tone,
      };
    case 'syncing':
      return {
        bridgeStatusKind: summary.bridgeStatusKind,
        chipLabel: summary.chipLabel,
        description: summary.description,
        title: 'Bridge sincronizando ahora',
        tone: summary.tone,
      };
    case 'phone_offline':
      return {
        bridgeStatusKind: summary.bridgeStatusKind,
        chipLabel: 'Sin conexión',
        description: summary.description,
        title: 'Teléfono sin internet',
        tone: summary.tone,
      };
    case 'bridge_unreachable':
      return {
        bridgeStatusKind: summary.bridgeStatusKind,
        chipLabel: 'Bridge no disponible',
        description: summary.description,
        title: 'Bridge configurado pero inaccesible',
        tone: 'warning',
      };
    case 'local_only':
      return {
        bridgeStatusKind: summary.bridgeStatusKind,
        chipLabel: 'Modo local',
        description: summary.description,
        title: 'Bridge configurado en modo local',
        tone: summary.tone,
      };
    case 'stale_backlog':
    case 'pending_backlog':
      return {
        bridgeStatusKind: summary.bridgeStatusKind,
        chipLabel: summary.chipLabel,
        description: summary.description,
        title: summary.title,
        tone: summary.tone,
      };
  }
}
