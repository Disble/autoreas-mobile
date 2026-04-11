import type {
  SyncRuntimeRegistrationStatus,
  SyncRuntimeTriggerSource,
} from '../../../sync/sync-runtime-status.types';
import type { SyncExecutionMode } from '../../../sync/sync-execution-mode.types';
import type { LayoutMode } from '../../../../hooks/use-responsive-layout';
import type { MetricTileTone } from './settings-screen.types';

export const BACKGROUND_SYNC_SECTION_TITLE = 'Estado de sync en segundo plano';

export const BACKGROUND_SYNC_REGISTRATION_LABELS: Record<
  SyncRuntimeRegistrationStatus,
  string
> = {
  registered: 'Registrado',
  unregistered: 'No registrado',
  unsupported: 'No soportado',
};

export const BACKGROUND_SYNC_TRIGGER_SOURCE_LABELS: Record<
  SyncRuntimeTriggerSource,
  string
> = {
  bootstrap: 'Inicio de la app',
  manual: 'Sync manual',
  app_active: 'Volvió al foreground',
  network_regained: 'Reconexión de red',
  ws_sync_required: 'WebSocket pidió sync',
  background_task: 'Task en segundo plano',
};

export const BACKGROUND_SYNC_EXECUTION_MODE_LABELS: Record<SyncExecutionMode, string> = {
  best_effort_background_task: 'Task best-effort',
  android_foreground_service: 'Servicio foreground Android',
};

export const METRIC_TILE_TONE_BG_CLASS: Record<MetricTileTone, string> = {
  default: 'bg-surface-secondary',
  accent: 'bg-accent/15',
  success: 'bg-success/15',
  warning: 'bg-warning/15',
  danger: 'bg-danger/15',
};

export const METRIC_TILE_TONE_TEXT_CLASS: Record<MetricTileTone, string> = {
  default: 'text-foreground',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export const METRIC_TILE_COLUMNS_BY_LAYOUT: Record<LayoutMode, number> = {
  phone: 2,
  'tablet-portrait': 3,
  'tablet-landscape': 3,
};

export const STATUS_CHIP_COLOR_BY_TONE: Record<
  MetricTileTone,
  'default' | 'accent' | 'success' | 'warning' | 'danger'
> = {
  default: 'default',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};
