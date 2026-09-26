import type { LayoutMode } from '../../../../hooks/responsive-layout.types';
import type {
  SyncRuntimeRegistrationStatus,
  SyncRuntimeTriggerSource,
} from '../../../sync/sync-runtime-status.types';
import type { SyncExecutionMode } from '../../../sync/sync-execution-mode.types';
import type {
  BackgroundSyncSectionTone,
  ConvergenceCountTileDescriptor,
} from './settings-screen.types';

/** Provides the shared background sync section title value. */

export const BACKGROUND_SYNC_SECTION_TITLE = 'Estado de sync en segundo plano';

/** Provides the shared background sync registration labels value. */

export const BACKGROUND_SYNC_REGISTRATION_LABELS: Record<
  SyncRuntimeRegistrationStatus,
  string
> = {
  registered: 'Registrado',
  unregistered: 'No registrado',
  unsupported: 'No soportado',
};

/** Provides the shared background sync trigger source labels value. */

export const BACKGROUND_SYNC_TRIGGER_SOURCE_LABELS: Record<
  SyncRuntimeTriggerSource,
  string
> = {
  bootstrap: 'Inicio de la app',
  manual: 'Sync manual',
  app_active: 'Volvió al foreground',
  network_regained: 'Reconexión de red',
  local_mutation: 'Cambio local',
  local_mutation_write: 'Escritura local fallida',
  ws_sync_required: 'WebSocket pidió sync',
  foreground_service: 'Servicio foreground',
  background_task: 'Task en segundo plano',
};

/** Provides the shared background sync execution mode labels value. */

export const BACKGROUND_SYNC_EXECUTION_MODE_LABELS: Record<SyncExecutionMode, string> = {
  best_effort_background_task: 'Task best-effort',
  android_foreground_service: 'Servicio foreground Android',
};

/** Provides the shared metric tile tone bg class value. */

export const METRIC_TILE_TONE_BG_CLASS: Record<BackgroundSyncSectionTone, string> = {
  default: 'bg-surface-secondary',
  accent: 'bg-accent/15',
  success: 'bg-success/15',
  warning: 'bg-warning/15',
  danger: 'bg-danger/15',
};

/** Provides the shared metric tile tone text class value. */

export const METRIC_TILE_TONE_TEXT_CLASS: Record<BackgroundSyncSectionTone, string> = {
  default: 'text-foreground',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** Provides the shared metric tile columns by layout value. */

export const METRIC_TILE_COLUMNS_BY_LAYOUT: Record<LayoutMode, number> = {
  phone: 2,
  'tablet-portrait': 3,
  'tablet-landscape': 3,
};

/** Provides the shared status chip color by tone value. */

export const STATUS_CHIP_COLOR_BY_TONE: Record<
  BackgroundSyncSectionTone,
  'default' | 'accent' | 'success' | 'warning' | 'danger'
> = {
  default: 'default',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

/**
 * The nine count-only convergence tiles, in the order the card renders them (design.md
 * `2026-09-09-convergence-instrumentation` Decision 6). One table driven by one loop replaces nine
 * structurally identical `pushCountTile` calls, which fallow reported as a single clone group.
 *
 * Each descriptor binds a tile's copy to the snapshot counter that decides whether it renders at
 * all: a `null` counter means "never measured" (Decision 7), so the tile is omitted rather than
 * zero-filled, while a measured `0` renders neutral. The two derived neighbours -- the oldest
 * pending age and the true backlog depth -- deliberately stay outside the table, because their
 * values are formatted and suffixed rather than pushed as a raw count.
 */

export const CONVERGENCE_COUNT_TILE_DESCRIPTORS: readonly ConvergenceCountTileDescriptor[] = [
  {
    snapshotField: 'lastDiagnosticsDiscardedCount',
    id: 'diagnosticsDiscardedCount',
    label: 'Diagnósticos descartados',
    iconName: 'close-circle-outline',
    nonZeroTone: 'danger',
  },
  {
    snapshotField: 'lastDiagnosticsFailedRemovalCount',
    id: 'diagnosticsFailedRemovalCount',
    label: 'Diagnósticos a reintentar',
    iconName: 'repeat-outline',
    nonZeroTone: 'warning',
  },
  {
    snapshotField: 'lastDiagnosticsUndeliverableCount',
    id: 'diagnosticsUndeliverableCount',
    label: 'Diagnósticos destruidos por declaración',
    iconName: 'remove-circle-outline',
    nonZeroTone: 'danger',
  },
  {
    snapshotField: 'lastDiagnosticsUnclassifiedCount',
    id: 'diagnosticsUnclassifiedCount',
    label: 'Diagnósticos sin clasificar',
    iconName: 'help-circle-outline',
    nonZeroTone: 'warning',
  },
  {
    snapshotField: 'lastDiagnosticsReapedCount',
    id: 'diagnosticsReapedCount',
    label: 'Diagnósticos retirados por antigüedad',
    iconName: 'alarm-outline',
    nonZeroTone: 'danger',
  },
  {
    snapshotField: 'lastOutboxFailedWriteCount',
    id: 'outboxFailedWriteCount',
    label: 'Escrituras de outbox fallidas',
    iconName: 'warning-outline',
    nonZeroTone: 'danger',
  },
  {
    snapshotField: 'lastDeadLetterCount',
    id: 'deadLetterCount',
    label: 'Operaciones bloqueadas',
    iconName: 'ban-outline',
    nonZeroTone: 'danger',
  },
  {
    snapshotField: 'lastConflictExhaustedCount',
    id: 'conflictExhaustedCount',
    label: 'Conflictos sin resolver',
    iconName: 'alert-outline',
    nonZeroTone: 'danger',
  },
  {
    snapshotField: 'lastStuckProcessingCount',
    id: 'stuckProcessingCount',
    label: 'Operaciones atascadas',
    iconName: 'hourglass-outline',
    nonZeroTone: 'warning',
  },
];


/** Maps responsive layout modes to the Settings content width class. */
export const SETTINGS_CONTAINER_WIDTH_CLASS: Readonly<Record<LayoutMode, string>> = {
  phone: 'max-w-full',
  'tablet-portrait': 'max-w-[760px]',
  'tablet-landscape': 'max-w-[1120px]',
};
