import type {
  SyncRuntimeRegistrationStatus,
  SyncRuntimeTriggerSource,
} from '../../../sync/sync-runtime-status.types';

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
