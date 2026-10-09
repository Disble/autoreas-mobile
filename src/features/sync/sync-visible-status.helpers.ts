import {
  SYNC_VISIBLE_STATUS_DAY_MS,
  SYNC_VISIBLE_STATUS_HOUR_MS,
  SYNC_VISIBLE_STATUS_MINUTE_MS,
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

/**
 * Builds "N cambio(s) guardado(s)" with singular wording when exactly one change is waiting.
 */
function buildSavedChangesPhrase(pendingOpsCount: number): string {
  if (pendingOpsCount === 1) {
    return '1 cambio guardado';
  }

  return `${pendingOpsCount} cambios guardados`;
}

/**
 * Builds the future "se enviará(n)" verb so it agrees with the number of pending changes.
 */
function buildWillBeSentVerb(pendingOpsCount: number): string {
  return pendingOpsCount === 1 ? 'Se enviará' : 'Se enviarán';
}

/**
 * Computes the milliseconds elapsed since the last successful sync, or null when it never happened.
 * Non-positive elapsed times are clamped to zero so in-flight or clock-skewed syncs read as "just now".
 */
function getElapsedSinceLastSync(lastSyncAt: number | null, now: Date): number | null {
  if (lastSyncAt === null) {
    return null;
  }

  return Math.max(0, now.getTime() - lastSyncAt);
}

/**
 * Formats the human-readable recency of the last sync, or null when there is no previous sync.
 * Scales from "hace un momento" through minutes, hours, and whole days.
 */
function formatLastSyncRecency(lastSyncAt: number | null, now: Date): string | null {
  const elapsedMilliseconds = getElapsedSinceLastSync(lastSyncAt, now);

  if (elapsedMilliseconds === null) {
    return null;
  }

  const minutesSinceLastSync = Math.floor(elapsedMilliseconds / SYNC_VISIBLE_STATUS_MINUTE_MS);
  if (minutesSinceLastSync < 1) {
    return 'hace un momento';
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

/**
 * Derives the visible status when nothing is waiting to be sent.
 * Every variant is neutral: a PC that is off or a device without Wi-Fi is the normal state of a local-first app.
 */
function deriveNoPendingSyncStatus(facts: SyncVisibleStatusFacts, now: Date): SyncVisibleStatus {
  if (facts.isBridgeConfigured === false) {
    return {
      chipLabel: 'Modo local',
      description:
        'La app funciona igual con tu catálogo en este dispositivo. Empareja una PC para tener una copia allí.',
      title: 'Sin PC emparejada',
      tone: 'default',
    };
  }

  if (facts.isDeviceOnline === false) {
    return {
      chipLabel: 'Sin Wi-Fi',
      description: 'Tu catálogo sigue disponible en este dispositivo.',
      title: 'Sin Wi-Fi',
      tone: 'default',
    };
  }

  const lastSyncRecency = formatLastSyncRecency(facts.lastSyncAt, now);

  return {
    chipLabel: 'Nada por enviar',
    description: lastSyncRecency
      ? `Último sync ${lastSyncRecency}.`
      : 'La PC todavía no respondió.',
    title: 'Nada por enviar',
    tone: 'default',
  };
}

/**
 * Derives the warning shown once a pending backlog has waited at least the stale threshold.
 * The copy asks whether the PC is on instead of implying that anything was lost.
 */
function deriveStaleBacklogStatus(pendingOpsCount: number, elapsedMilliseconds: number): SyncVisibleStatus {
  const daysSinceLastSync = Math.floor(elapsedMilliseconds / SYNC_VISIBLE_STATUS_DAY_MS);
  const backlogPhrase =
    pendingOpsCount === 1
      ? 'Tu cambio sigue guardado en este dispositivo, pero la PC no lo ha recibido.'
      : `Tus ${pendingOpsCount} cambios siguen guardados en este dispositivo, pero la PC no los ha recibido.`;

  return {
    chipLabel: 'Esperando a la PC',
    description: `${backlogPhrase} ¿Está encendida y en la misma red?`,
    title: `Hace ${daysSinceLastSync} días que no hay sync`,
    tone: 'warning',
  };
}

/**
 * Derives the visible status when changes are waiting to be sent.
 * Waiting stays neutral until the stale threshold, and never escalates past `warning`.
 */
function derivePendingSyncStatus(facts: SyncVisibleStatusFacts, now: Date): SyncVisibleStatus {
  const { pendingOpsCount } = facts;
  const savedChanges = buildSavedChangesPhrase(pendingOpsCount);
  const willBeSent = buildWillBeSentVerb(pendingOpsCount);

  if (facts.isBridgeConfigured === false) {
    return {
      chipLabel: 'Modo local',
      description: 'Empareja una PC para tener una copia allí.',
      title: `${savedChanges} en este dispositivo`,
      tone: 'default',
    };
  }

  if (facts.isDeviceOnline === false) {
    return {
      chipLabel: 'Sin Wi-Fi',
      description: `Tienes ${savedChanges} en este dispositivo. ${willBeSent} cuando vuelvas a conectarte.`,
      title: 'Sin Wi-Fi',
      tone: 'default',
    };
  }

  const elapsedMilliseconds = getElapsedSinceLastSync(facts.lastSyncAt, now);
  if (
    elapsedMilliseconds !== null &&
    elapsedMilliseconds >= SYNC_VISIBLE_STATUS_STALE_WARNING_HOURS * SYNC_VISIBLE_STATUS_HOUR_MS
  ) {
    return deriveStaleBacklogStatus(pendingOpsCount, elapsedMilliseconds);
  }

  return {
    chipLabel: 'Esperando a la PC',
    description: `Tienes ${savedChanges} en este dispositivo. ${willBeSent} ${
      pendingOpsCount === 1 ? 'solo' : 'solos'
    } cuando la PC esté encendida.`,
    title: 'Esperando a la PC',
    tone: 'default',
  };
}

/**
 * Derives the shared local-first sync status copy used across screens.
 * Tone ladder: neutral while the PC is off or the device is offline, `warning` only for a backlog
 * stale for 72 h, and `danger` only when the PC answered and rejected the sync.
 */
export function deriveVisibleSyncStatus(
  facts: SyncVisibleStatusFacts,
  now: Date,
): SyncVisibleStatus {
  if (facts.connectionStatus === 'syncing') {
    return {
      chipLabel: 'Sincronizando',
      description: 'Enviando tus cambios a la PC.',
      title: 'Sincronizando',
      tone: 'accent',
    };
  }

  if (facts.connectionStatus === 'online' && facts.pendingOpsCount === 0) {
    const lastSyncRecency = formatLastSyncRecency(facts.lastSyncAt, now);

    return {
      chipLabel: 'Al día',
      description: lastSyncRecency
        ? `Último sync ${lastSyncRecency}.`
        : 'Todo lo que cambiaste ya está en la PC.',
      title: 'Al día',
      tone: 'success',
    };
  }

  if (facts.connectionStatus === 'sync_error') {
    return {
      chipLabel: 'Envío rechazado',
      description:
        'La PC respondió, pero rechazó el envío. Tus cambios siguen guardados en este dispositivo.',
      title: 'La PC no aceptó tus cambios',
      tone: 'danger',
    };
  }

  if (facts.pendingOpsCount === 0) {
    return deriveNoPendingSyncStatus(facts, now);
  }

  return derivePendingSyncStatus(facts, now);
}
