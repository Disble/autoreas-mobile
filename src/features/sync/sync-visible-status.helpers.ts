import {
  SYNC_VISIBLE_STATUS_STALE_DANGER_DAYS,
  SYNC_VISIBLE_STATUS_STALE_WARNING_HOURS,
} from './sync-visible-status.constants';
import type { SyncVisibleStatus, SyncVisibleStatusFacts } from './sync-visible-status.types';

/**
 * Resolves whether a manual sync attempt has a real chance to start right now.
 * The gate centralizes the shared transport prerequisites so screens can disable affordances consistently.
 */
export function isManualSyncAvailableNow(facts: SyncVisibleStatusFacts): boolean {
  if (facts.isDeviceOnline === false) {
    return false;
  }

  if (facts.isBridgeConfigured === false) {
    return false;
  }

  if (facts.connectionStatus === 'syncing') {
    return false;
  }

  return true;
}

function buildPendingChangesLabel(pendingOpsCount: number): string {
  if (pendingOpsCount === 1) {
    return '1 cambio pendiente';
  }

  return `${pendingOpsCount} cambios pendientes`;
}

function buildPendingChangesTitle(pendingOpsCount: number): string {
  if (pendingOpsCount === 1) {
    return '1 cambio esperando sync';
  }

  return `${pendingOpsCount} cambios esperando sync`;
}

function getDaysSinceLastSync(lastSyncAt: number | null, now: Date): number | null {
  if (lastSyncAt === null) {
    return null;
  }

  const elapsedMilliseconds = now.getTime() - lastSyncAt;
  if (elapsedMilliseconds <= 0) {
    return 0;
  }

  return Math.floor(elapsedMilliseconds / (24 * 60 * 60 * 1000));
}

function getMinutesSinceLastSync(lastSyncAt: number | null, now: Date): number | null {
  if (lastSyncAt === null) {
    return null;
  }

  const elapsedMilliseconds = now.getTime() - lastSyncAt;
  if (elapsedMilliseconds <= 0) {
    return 0;
  }

  return Math.floor(elapsedMilliseconds / (60 * 1000));
}

function formatLastSyncRecency(lastSyncAt: number | null, now: Date): string | null {
  const minutesSinceLastSync = getMinutesSinceLastSync(lastSyncAt, now);

  if (minutesSinceLastSync === null) {
    return null;
  }

  if (minutesSinceLastSync < 1) {
    return 'recién';
  }

  if (minutesSinceLastSync < 60) {
    return `hace ${minutesSinceLastSync} min`;
  }

  const hoursSinceLastSync = Math.floor(minutesSinceLastSync / 60);
  if (hoursSinceLastSync < 24) {
    return hoursSinceLastSync === 1 ? 'hace 1 h' : `hace ${hoursSinceLastSync} h`;
  }

  const daysSinceLastSync = Math.floor(hoursSinceLastSync / 24);

  return daysSinceLastSync === 1 ? 'hace 1 día' : `hace ${daysSinceLastSync} días`;
}

function getLocalModeDescription(syncError: string | null): string {
  if (syncError) {
    return 'El último intento con el bridge falló, pero tu catálogo local sigue disponible en este dispositivo.';
  }

  return 'Podés seguir usando esta copia local mientras el bridge no esté disponible.';
}

function getUnpairedLocalModeDescription(): string {
  return 'No hay bridge emparejado. Esta app sigue funcionando con tu copia local en este dispositivo.';
}

function getOfflinePhoneDescription(hasPendingChanges: boolean): string {
  if (hasPendingChanges) {
    return 'Este teléfono está sin internet. Tus cambios siguen guardados en este dispositivo y se van a reintentar cuando vuelva la conexión.';
  }

  return 'Este teléfono está sin internet. Tu copia local sigue disponible y el sync se va a reintentar cuando vuelva la conexión.';
}

function deriveNoPendingSyncStatus(
  facts: SyncVisibleStatusFacts,
): SyncVisibleStatus {
  if (facts.isBridgeConfigured === false) {
    return {
      chipLabel: 'Modo local',
      description: getUnpairedLocalModeDescription(),
      title: 'Catálogo local listo',
      tone: 'default',
    };
  }

  if (facts.isDeviceOnline === false) {
    return {
      chipLabel: 'Sin conexión',
      description: getOfflinePhoneDescription(false),
      title: 'Catálogo local listo',
      tone: 'default',
    };
  }

  return {
    chipLabel: 'Catálogo local',
    description: getLocalModeDescription(facts.syncError),
    title: 'Catálogo local listo',
    tone: 'default',
  };
}

/**
 * Derives the shared offline-first sync status copy used across screens.
 * Centralizing the copy and thresholds keeps local/bridge semantics consistent without global state.
 */
export function deriveVisibleSyncStatus(
  facts: SyncVisibleStatusFacts,
  now: Date,
): SyncVisibleStatus {
  if (facts.connectionStatus === 'syncing') {
    return {
      chipLabel: 'Sincronizando',
      description: 'Estamos reconciliando tu copia local con el bridge.',
      title: 'Sincronizando cambios',
      tone: 'accent',
    };
  }

  if (facts.connectionStatus === 'online' && facts.pendingOpsCount === 0) {
    const lastSyncRecency = formatLastSyncRecency(facts.lastSyncAt, now);

    return {
      chipLabel: 'Bridge activo',
      description: lastSyncRecency
        ? `Última sincronización ${lastSyncRecency}.`
        : 'La copia local está al día con el bridge.',
      title: 'Catálogo al día',
      tone: 'success',
    };
  }

  if (facts.pendingOpsCount === 0) {
    return deriveNoPendingSyncStatus(facts);
  }

  const pendingChangesLabel = buildPendingChangesLabel(facts.pendingOpsCount);
  const pendingChangesTitle = buildPendingChangesTitle(facts.pendingOpsCount);

  if (facts.isBridgeConfigured === false) {
    return {
      chipLabel: 'Sync pendiente',
      description:
        'Tus cambios siguen guardados en este dispositivo. Emparejá un bridge para confirmarlos fuera de este teléfono.',
      title: pendingChangesTitle,
      tone: 'warning',
    };
  }

  if (facts.isDeviceOnline === false) {
    return {
      chipLabel: 'Sin conexión',
      description: getOfflinePhoneDescription(true),
      title: pendingChangesTitle,
      tone: 'warning',
    };
  }

  const daysSinceLastSync = getDaysSinceLastSync(facts.lastSyncAt, now);
  const shouldEscalateStaleBacklog =
    daysSinceLastSync !== null &&
    daysSinceLastSync * 24 >= SYNC_VISIBLE_STATUS_STALE_WARNING_HOURS;

  if (shouldEscalateStaleBacklog) {
    return {
      chipLabel: 'Sync pendiente',
      description: `Tus cambios siguen guardados en este dispositivo. Hace ${daysSinceLastSync} días que el bridge no confirma cambios.`,
      title: pendingChangesTitle,
      tone:
        daysSinceLastSync >= SYNC_VISIBLE_STATUS_STALE_DANGER_DAYS ? 'danger' : 'warning',
    };
  }

  return {
    chipLabel: 'Sync pendiente',
    description: `Tus cambios siguen guardados localmente y se van a reintentar cuando el bridge vuelva. ${pendingChangesLabel}.`,
    title: pendingChangesTitle,
    tone: 'warning',
  };
}
