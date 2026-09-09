import type {
  BackgroundSyncSection,
  BuildBackgroundSyncSectionInput,
  MetricTile,
  MetricTileIconName,
  BackgroundSyncSectionTone,
  ResolvedToneColors,
} from './settings-screen.types';
import type { SyncRuntimeRegistrationStatus } from '../../../sync/sync-runtime-status.types';
import { RECONCILE_BACKLOG_BATCH_LIMIT } from '../../../sync/reconcile.constants';
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

/** Resolves the tone and icon for the registration-status tile from the runtime's status value. */
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

/**
 * Appends the timestamp/trigger tiles that only render once their underlying value is known.
 * Each is omitted, not zero-filled, while its snapshot field is still `null`.
 */
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
 * Formats an age in milliseconds into a compact, human-readable duration. `null` -- an empty
 * queue has no oldest row -- renders the same "no data" copy every other optional tile uses.
 */
function formatOldestPendingAge(ms: number | null): string {
  if (ms === null) {
    return 'Sin datos';
  }
  if (ms < 60_000) {
    return `${Math.round(ms / 1_000)} s`;
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)} min`;
  }
  return `${Math.round(ms / 3_600_000)} h`;
}

/** Static shape shared by every count-only convergence tile: id, label, icon, and the tone it escalates to once the count is non-zero. */
interface CountTileConfig {
  readonly id: string;
  readonly label: string;
  readonly iconName: MetricTileIconName;
  readonly nonZeroTone: BackgroundSyncSectionTone;
}

/**
 * Pushes one count-based convergence tile, ONLY when `count` is not `null`: a `null` counter
 * means "never measured" (Decision 7), not zero, so omitting the tile is the honest choice --
 * exactly how `appendOptionalRuntimeTiles` already treats `lastAttempt`/`lastSuccess`. Factored
 * out so `appendConvergenceMetricTiles` reads as a flat list of calls instead of six near-
 * identical `if` blocks inflating its own complexity budget.
 */
function pushCountTile(tiles: MetricTile[], count: number | null, config: CountTileConfig): void {
  if (count === null) {
    return;
  }
  tiles.push({
    id: config.id,
    label: config.label,
    value: String(count),
    tone: count > 0 ? config.nonZeroTone : 'default',
    iconName: config.iconName,
  });
}

/**
 * Appends the true-backlog-depth tile. `hasMore` is DERIVED here rather than read from a stored
 * flag (Decision 1): storing it would let it go stale against the count beside it.
 */
function appendPendingRowCountTile(tiles: MetricTile[], count: number | null): void {
  if (count === null) {
    return;
  }
  const hasMore = count > RECONCILE_BACKLOG_BATCH_LIMIT;
  tiles.push({
    id: 'pendingRowCount',
    label: 'Backlog total',
    value: hasMore ? `${count}+` : String(count),
    tone: hasMore ? 'warning' : 'default',
    iconName: 'layers-outline',
  });
}

/**
 * Appends the eight convergence-instrumentation tiles (design.md
 * `2026-09-09-convergence-instrumentation` Decision 6), one per counter, beside
 * `backlogReadCount`. Each renders ONLY when its counter is not `null` (Decision 7).
 */
function appendConvergenceMetricTiles(
  tiles: MetricTile[],
  snapshot: BuildBackgroundSyncSectionInput['snapshot'],
): void {
  pushCountTile(tiles, snapshot.lastDiagnosticsDiscardedCount, {
    id: 'diagnosticsDiscardedCount',
    label: 'Diagnósticos descartados',
    iconName: 'close-circle-outline',
    nonZeroTone: 'danger',
  });
  pushCountTile(tiles, snapshot.lastDiagnosticsFailedRemovalCount, {
    id: 'diagnosticsFailedRemovalCount',
    label: 'Diagnósticos a reintentar',
    iconName: 'repeat-outline',
    nonZeroTone: 'warning',
  });
  pushCountTile(tiles, snapshot.lastOutboxFailedWriteCount, {
    id: 'outboxFailedWriteCount',
    label: 'Escrituras de outbox fallidas',
    iconName: 'warning-outline',
    nonZeroTone: 'danger',
  });
  pushCountTile(tiles, snapshot.lastDeadLetterCount, {
    id: 'deadLetterCount',
    label: 'Operaciones bloqueadas',
    iconName: 'ban-outline',
    nonZeroTone: 'danger',
  });
  pushCountTile(tiles, snapshot.lastConflictExhaustedCount, {
    id: 'conflictExhaustedCount',
    label: 'Conflictos sin resolver',
    iconName: 'alert-outline',
    nonZeroTone: 'danger',
  });
  pushCountTile(tiles, snapshot.lastStuckProcessingCount, {
    id: 'stuckProcessingCount',
    label: 'Operaciones atascadas',
    iconName: 'hourglass-outline',
    nonZeroTone: 'warning',
  });
  if (snapshot.lastOldestPendingAgeMs !== null) {
    tiles.push({ id: 'oldestPendingAgeMs', label: 'Antigüedad máxima pendiente', value: formatOldestPendingAge(snapshot.lastOldestPendingAgeMs), tone: 'default', iconName: 'time-outline' });
  }
  appendPendingRowCountTile(tiles, snapshot.lastPendingRowCount);
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

/** Builds the full ordered tile list the Settings background-sync card renders. */
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

  appendConvergenceMetricTiles(tiles, snapshot);

  if (snapshot.lastFailureMessage) {
    tiles.push({ id: 'lastFailure', label: 'Último fallo', value: snapshot.lastFailureMessage, tone: 'danger', iconName: 'alert-circle-outline', span: 'full' });
  }
  return tiles;
}

/** Builds the section copy and status tone for a bridge that IS configured (paired). */
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
