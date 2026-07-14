import type { LayoutMode } from '../../../../hooks/responsive-layout.types';
import type {
  SyncRuntimeRegistrationStatus,
  SyncRuntimeTriggerSource,
} from '../../../sync/sync-runtime-status.types';
import type { SyncExecutionMode } from '../../../sync/sync-execution-mode.types';
import type { BackgroundSyncSectionTone } from './settings-screen.types';

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


/** Maps responsive layout modes to the Settings content width class. */
export const SETTINGS_CONTAINER_WIDTH_CLASS: Readonly<Record<LayoutMode, string>> = {
  phone: 'max-w-full',
  'tablet-portrait': 'max-w-[760px]',
  'tablet-landscape': 'max-w-[1120px]',
};
