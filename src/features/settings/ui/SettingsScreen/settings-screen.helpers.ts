import type {
  BackgroundSyncSection,
  BuildBackgroundSyncSectionInput,
  MetricTile,
  MetricTileIconName,
  BackgroundSyncSectionTone,
  ResolvedToneColors,
} from './settings-screen.types';
import type { SyncRuntimeRegistrationStatus } from '../../../sync/sync-runtime-status.types';
import {
  BACKGROUND_SYNC_EXECUTION_MODE_LABELS,
  BACKGROUND_SYNC_REGISTRATION_LABELS,
  BACKGROUND_SYNC_TRIGGER_SOURCE_LABELS,
} from './settings-screen.constants';

/**
 * Formats runtime timestamps into a stable, readable UTC label for the Settings surface.
 * Using a deterministic formatter keeps tests and diagnostics aligned across devices.
 */
export function formatBackgroundSyncTimestamp(timestamp: number | null) {
  if (timestamp === null) {
    return 'Sin datos';
  }

  const date = new Date(timestamp);

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:${String(
    date.getUTCMinutes(),
  ).padStart(2, '0')} UTC`;
}

function resolveRegistrationTile(
  status: SyncRuntimeRegistrationStatus,
): { readonly tone: BackgroundSyncSectionTone; readonly iconName: MetricTileIconName } {
  switch (status) {
    case 'registered':
      return { tone: 'success', iconName: 'shield-checkmark-outline' };
    case 'unsupported':
      return { tone: 'warning', iconName: 'shield-outline' };
    default:
      return { tone: 'warning', iconName: 'shield-half-outline' };
  }
}

function appendOptionalRuntimeTiles(
  tiles: MetricTile[],
  snapshot: BuildBackgroundSyncSectionInput['snapshot'],
): void {
  if (snapshot.lastAttemptAt !== null) {
    tiles.push({ id: 'lastAttempt', label: 'Último intento', value: formatBackgroundSyncTimestamp(snapshot.lastAttemptAt), tone: 'default', iconName: 'time-outline' });
  }
  if (snapshot.lastSuccessAt !== null) {
    tiles.push({ id: 'lastSuccess', label: 'Último éxito', value: formatBackgroundSyncTimestamp(snapshot.lastSuccessAt), tone: 'success', iconName: 'checkmark-done-outline' });
  }
  if (snapshot.lastTriggerSource) {
    tiles.push({ id: 'lastTrigger', label: 'Último origen', value: BACKGROUND_SYNC_TRIGGER_SOURCE_LABELS[snapshot.lastTriggerSource], tone: 'accent', iconName: 'flash-outline' });
  }
}

/**
 * Builds the two independent registration-path tiles (FGS + WorkManager) plus the
 * notification-permission tile. Both paths always render simultaneously so Settings
 * exposes honest per-path visibility instead of collapsing them into one status.
 */
function buildRegistrationPathTiles(
  snapshot: BuildBackgroundSyncSectionInput['snapshot'],
): MetricTile[] {
  return [
    {
      id: 'foregroundService',
      label: 'Servicio persistente',
      value: snapshot.isForegroundServiceRunning ? 'Activo' : 'Inactivo',
      tone: snapshot.isForegroundServiceRunning ? 'success' : 'warning',
      iconName: snapshot.isForegroundServiceRunning ? 'radio-outline' : 'pause-circle-outline',
    },
    {
      id: 'backgroundTask',
      label: 'Task periódico',
      value: snapshot.isBackgroundTaskRegistered ? 'Registrado' : 'No registrado',
      tone: snapshot.isBackgroundTaskRegistered ? 'success' : 'warning',
      iconName: snapshot.isBackgroundTaskRegistered ? 'sync-circle-outline' : 'pause-circle-outline',
    },
    {
      id: 'notificationPermission',
      label: 'Notif. persistente',
      value: snapshot.canShowPersistentNotification ? 'Permitida' : 'No disponible',
      tone: snapshot.canShowPersistentNotification ? 'success' : 'warning',
      iconName: snapshot.canShowPersistentNotification
        ? 'notifications-outline'
        : 'notifications-off-outline',
    },
  ];
}

function buildRuntimeMetricTiles(
  snapshot: BuildBackgroundSyncSectionInput['snapshot'],
): MetricTile[] {
  const registrationShape = resolveRegistrationTile(snapshot.registrationStatus);
  const tiles: MetricTile[] = [
    {
      id: 'executionMode',
      label: 'Modo',
      value: BACKGROUND_SYNC_EXECUTION_MODE_LABELS[snapshot.executionMode],
      tone: snapshot.executionMode === 'android_foreground_service' ? 'accent' : 'default',
      iconName:
        snapshot.executionMode === 'android_foreground_service'
          ? 'notifications-outline'
          : 'timer-outline',
    },
    {
      id: 'registration',
      label: 'Registro',
      value: BACKGROUND_SYNC_REGISTRATION_LABELS[snapshot.registrationStatus],
      tone: registrationShape.tone,
      iconName: registrationShape.iconName,
    },
  ];

  appendOptionalRuntimeTiles(tiles, snapshot);

  tiles.push(
    { id: 'syncedCount', label: 'Ops. confirmadas', value: String(snapshot.lastSyncedCount), tone: 'default', iconName: 'sync-outline' },
    { id: 'backlogReadCount', label: 'Backlog leído', value: String(snapshot.lastBacklogReadCount), tone: 'default', iconName: 'list-outline' },
    { id: 'prunedOperationsCount', label: 'Ops. podadas', value: String(snapshot.lastPrunedOperationsCount), tone: snapshot.lastPrunedOperationsCount > 0 ? 'success' : 'default', iconName: 'trash-outline' },
    { id: 'cycleActive', label: 'Ciclo activo', value: snapshot.isCycleActive ? 'Sí' : 'No', tone: snapshot.isCycleActive ? 'accent' : 'default', iconName: snapshot.isCycleActive ? 'pulse-outline' : 'power-outline' },
    ...buildRegistrationPathTiles(snapshot),
  );

  if (snapshot.lastFailureMessage) {
    tiles.push({ id: 'lastFailure', label: 'Último fallo', value: snapshot.lastFailureMessage, tone: 'danger', iconName: 'alert-circle-outline', span: 'full' });
  }
  return tiles;
}

function buildConfiguredBackgroundSyncSection(
  snapshot: BuildBackgroundSyncSectionInput['snapshot'],
): BackgroundSyncSection {
  const tiles = buildRuntimeMetricTiles(snapshot);
  if (snapshot.lastFailureMessage) {
    return {
      title: 'Último sync con error',
      description: 'La app guarda el último fallo conocido para que puedas entender el estado sin abrir logs ni debugger.',
      status: BACKGROUND_SYNC_REGISTRATION_LABELS[snapshot.registrationStatus],
      statusTone: 'danger',
      tiles,
    };
  }

  const isForegroundService = snapshot.executionMode === 'android_foreground_service';
  if (snapshot.registrationStatus === 'registered' && snapshot.lastSuccessAt !== null) {
    return {
      title: isForegroundService ? 'Sync continuo operativo' : 'Sync en segundo plano operativo',
      description: isForegroundService
        ? 'La app expone un servicio foreground con notificación persistente para sostener el sync continuo en Android.'
        : 'El task periódico figura registrado y el snapshot local ya tiene al menos un ciclo exitoso.',
      status: 'Registrado',
      statusTone: 'success',
      tiles,
    };
  }

  if (snapshot.registrationStatus === 'registered') {
    return {
      title: isForegroundService ? 'Sync continuo pendiente' : 'Sync en segundo plano pendiente',
      description: isForegroundService
        ? 'El modo foreground está preparado, pero todavía no hay un ciclo exitoso observado con el servicio persistente.'
        : 'El task está registrado, pero todavía no hay un ciclo exitoso observado en este dispositivo.',
      status: 'Registrado',
      statusTone: 'accent',
      tiles,
    };
  }

  return {
    title: 'Sync en segundo plano no registrado',
    description: isForegroundService
      ? 'La app está emparejada, pero el servicio foreground todavía no quedó activo en este dispositivo.'
      : 'La app está emparejada, pero todavía no observa un registro activo del task periódico.',
    status: 'No registrado',
    statusTone: 'warning',
    tiles,
  };
}

/**
 * Maps the persisted runtime snapshot into presentation copy for Settings.
 * This keeps status wording centralized so the TSX stays a pure render function.
 */
export function buildBackgroundSyncSection({
  isConfigured,
  snapshot,
}: BuildBackgroundSyncSectionInput): BackgroundSyncSection {
  if (!isConfigured) {
    return {
      title: 'Sync en segundo plano inactivo',
      description: 'Emparejá un bridge para habilitar el runtime de sync y exponer estado real en segundo plano.',
      status: 'Sin bridge emparejado',
      statusTone: 'warning',
      tiles: [{ id: 'registration', label: 'Registro', value: 'No disponible sin bridge emparejado', tone: 'warning', iconName: 'link-outline' }],
    };
  }

  if (snapshot.registrationStatus === 'unsupported') {
    return {
      title: 'Sync en segundo plano no soportado',
      description: 'Este binario no expone SQLite/Background Task, así que la app no puede registrar el sync periódico.',
      status: 'No soportado',
      statusTone: 'warning',
      tiles: [{ id: 'registration', label: 'Registro', value: 'No soportado', tone: 'warning', iconName: 'shield-outline' }],
    };
  }

  return buildConfiguredBackgroundSyncSection(snapshot);
}

/**
 * Splits metric tiles into rows of the requested column count, promoting any
 * tile marked as `span: 'full'` to its own row so the grid stays balanced.
 */
export function chunkTiles(
  tiles: readonly MetricTile[],
  columns: number,
): MetricTile[][] {
  const rows: MetricTile[][] = [];
  let current: MetricTile[] = [];

  for (const tile of tiles) {
    if (tile.span === 'full') {
      if (current.length > 0) {
        rows.push(current);
        current = [];
      }
      rows.push([tile]);
      continue;
    }

    current.push(tile);

    if (current.length === columns) {
      rows.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    rows.push(current);
  }

  return rows;
}

/**
 * Resolves the icon color for a metric tile tone so the grid renders with the
 * same semantic palette used elsewhere in the Settings surface.
 */
export function resolveToneIconColor(
  tone: BackgroundSyncSectionTone,
  colors: ResolvedToneColors,
): string {
  switch (tone) {
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'danger':
      return colors.danger;
    case 'accent':
      return colors.foreground;
    default:
      return colors.muted;
  }
}
