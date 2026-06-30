import {
  buildBackgroundSyncSection,
  formatBackgroundSyncTimestamp,
} from '../../../../src/features/settings/ui/SettingsScreen/settings-screen.helpers';
import {
  buildSettingsBridgeStatus,
  buildSettingsSyncSummary,
} from '../../../../src/features/settings/ui/SettingsScreen/settings-sync-status.helpers';

describe('settings-screen.helpers', () => {
  it('formats timestamps into a readable deterministic UTC string', () => {
    expect(formatBackgroundSyncTimestamp(1775812200000)).toBe('2026-04-10 09:10 UTC');
  });

  it('builds a failure-oriented section for paired devices with a failed latest attempt', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775811900000,
        lastFailureMessage: 'Bridge timeout after 10s',
        lastTriggerSource: 'background_task',
        lastSyncedCount: 4,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
      },
    });

    expect(section.statusTone).toBe('danger');
    expect(section.title).toBe('Último sync con error');
    expect(section.status).toBe('Registrado');

    const tileMap = Object.fromEntries(section.tiles.map((tile) => [tile.id, tile]));

    expect(tileMap.registration).toMatchObject({
      label: 'Registro',
      value: 'Registrado',
      tone: 'success',
      iconName: 'shield-checkmark-outline',
    });
    expect(tileMap.executionMode).toMatchObject({
      label: 'Modo',
      value: 'Task best-effort',
    });
    expect(tileMap.lastAttempt).toMatchObject({
      label: 'Último intento',
      value: '2026-04-10 09:10 UTC',
      tone: 'default',
      iconName: 'time-outline',
    });
    expect(tileMap.lastSuccess).toMatchObject({
      label: 'Último éxito',
      value: '2026-04-10 09:05 UTC',
      tone: 'success',
      iconName: 'checkmark-done-outline',
    });
    expect(tileMap.lastTrigger).toMatchObject({
      label: 'Último origen',
      value: 'Task en segundo plano',
      tone: 'accent',
      iconName: 'flash-outline',
    });
    expect(tileMap.syncedCount).toMatchObject({
      label: 'Ops. confirmadas',
      value: '4',
      tone: 'default',
      iconName: 'sync-outline',
    });
    expect(tileMap.backlogReadCount).toMatchObject({
      label: 'Backlog leído',
      value: '0',
      tone: 'default',
      iconName: 'list-outline',
    });
    expect(tileMap.prunedOperationsCount).toMatchObject({
      label: 'Ops. podadas',
      value: '0',
      tone: 'default',
      iconName: 'trash-outline',
    });
    expect(tileMap.cycleActive).toMatchObject({
      label: 'Ciclo activo',
      value: 'No',
      tone: 'default',
      iconName: 'power-outline',
    });
    expect(tileMap.foregroundService).toMatchObject({
      label: 'Servicio persistente',
      value: 'Inactivo',
    });
    expect(tileMap.lastFailure).toMatchObject({
      label: 'Último fallo',
      value: 'Bridge timeout after 10s',
      tone: 'danger',
      iconName: 'alert-circle-outline',
      span: 'full',
    });
  });

  it('builds a success-oriented section when the periodic task has at least one successful run', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775811900000,
        lastFailureMessage: null,
        lastTriggerSource: 'app_active',
        lastSyncedCount: 12,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
      },
    });

    expect(section.statusTone).toBe('success');
    expect(section.title).toBe('Sync en segundo plano operativo');
    expect(section.tiles.find((tile) => tile.id === 'lastFailure')).toBeUndefined();
    expect(section.tiles.map((tile) => tile.id)).toEqual(
      expect.arrayContaining([
        'executionMode',
        'registration',
        'lastAttempt',
        'lastSuccess',
        'lastTrigger',
        'syncedCount',
        'backlogReadCount',
        'prunedOperationsCount',
        'cycleActive',
        'foregroundService',
        'notificationPermission',
      ]),
    );
  });

  it('builds a foreground-service oriented section for Android continuous sync mode', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'android_foreground_service',
        isForegroundServiceRunning: true,
        canShowPersistentNotification: true,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775811900000,
        lastFailureMessage: null,
        lastTriggerSource: 'background_task',
        lastSyncedCount: 8,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
      },
    });

    expect(section.title).toBe('Sync continuo operativo');
    expect(section.description).toContain('servicio foreground');

    const tileMap = Object.fromEntries(section.tiles.map((tile) => [tile.id, tile]));

    expect(tileMap.executionMode.value).toBe('Servicio foreground Android');
    expect(tileMap.foregroundService.value).toBe('Activo');
    expect(tileMap.notificationPermission.value).toBe('Permitida');
  });

  it('reflects active cycle and recent pruning in tile tones', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775812200000,
        lastFailureMessage: null,
        lastTriggerSource: 'app_active',
        lastSyncedCount: 3,
        isCycleActive: true,
        lastBacklogReadCount: 150,
        lastPrunedOperationsCount: 42,
      },
    });

    const tileMap = Object.fromEntries(section.tiles.map((tile) => [tile.id, tile]));

    expect(tileMap.cycleActive).toMatchObject({
      label: 'Ciclo activo',
      value: 'Sí',
      tone: 'accent',
      iconName: 'pulse-outline',
    });
    expect(tileMap.backlogReadCount).toMatchObject({
      label: 'Backlog leído',
      value: '150',
      tone: 'default',
      iconName: 'list-outline',
    });
    expect(tileMap.prunedOperationsCount).toMatchObject({
      label: 'Ops. podadas',
      value: '42',
      tone: 'success',
      iconName: 'trash-outline',
    });
  });

  it('emits only a single "not available" tile when the bridge is not paired', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: false,
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775812200000,
        lastFailureMessage: null,
        lastTriggerSource: 'manual',
        lastSyncedCount: 0,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
      },
    });

    expect(section.statusTone).toBe('warning');
    expect(section.title).toBe('Sync en segundo plano inactivo');
    expect(section.status).toBe('Sin bridge emparejado');
    expect(section.description).toContain('Emparejá un bridge');
    expect(section.tiles).toEqual([
      {
        id: 'registration',
        label: 'Registro',
        value: 'No disponible sin bridge emparejado',
        tone: 'warning',
        iconName: 'link-outline',
      },
    ]);
  });

  it('marks registration as warning tone when the runtime is unsupported', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: true,
      snapshot: {
        registrationStatus: 'unsupported',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureMessage: null,
        lastTriggerSource: null,
        lastSyncedCount: 0,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
      },
    });

    expect(section.statusTone).toBe('warning');
    expect(section.title).toBe('Sync en segundo plano no soportado');
    expect(section.tiles).toEqual([
      {
        id: 'registration',
        label: 'Registro',
        value: 'No soportado',
        tone: 'warning',
        iconName: 'shield-outline',
      },
    ]);
  });

  it('builds a calm local-only summary with setup guidance when no bridge is paired', () => {
    const summary = buildSettingsSyncSummary({
      isConfigured: false,
      isDeviceOnline: true,
      now: new Date('2026-04-09T10:00:00.000Z'),
      syncFacts: {
        connectionStatus: 'offline',
        lastSyncAt: null,
        pendingOpsCount: 0,
        syncError: null,
      },
    });

    expect(summary.tone).toBe('default');
    expect(summary.chipLabel).toBe('Modo local');
    expect(summary.title).toBe('Catálogo local listo');
    expect(summary.description).toContain('No hay bridge emparejado');
    expect(summary.bridgeStatusKind).toBe('unpaired');
    expect(summary.actionKind).toBe('go_to_setup');
    expect(summary.actionLabel).toBe('Emparejar bridge');
  });

  it('keeps phone-offline pending sync separate from bridge repair actions', () => {
    const summary = buildSettingsSyncSummary({
      isConfigured: true,
      isDeviceOnline: false,
      now: new Date('2026-04-09T10:00:00.000Z'),
      syncFacts: {
        connectionStatus: 'error',
        lastSyncAt: new Date('2026-04-08T10:00:00.000Z').getTime(),
        pendingOpsCount: 2,
        syncError: 'Bridge unreachable at http://192.168.1.10:8080',
      },
    });

    expect(summary.tone).toBe('warning');
    expect(summary.chipLabel).toBe('Sin conexión');
    expect(summary.title).toBe('2 cambios esperando sync');
    expect(summary.description).toContain('teléfono está sin internet');
    expect(summary.bridgeStatusKind).toBe('phone_offline');
    expect(summary.actionKind).toBeNull();
    expect(summary.actionLabel).toBeNull();
  });

  it('guides the user to repair the bridge when local backlog exists and the phone is online', () => {
    const summary = buildSettingsSyncSummary({
      isConfigured: true,
      isDeviceOnline: true,
      now: new Date('2026-04-09T10:00:00.000Z'),
      syncFacts: {
        connectionStatus: 'error',
        lastSyncAt: new Date('2026-04-08T10:00:00.000Z').getTime(),
        pendingOpsCount: 3,
        syncError: 'Bridge unreachable at http://192.168.1.10:8080',
      },
    });

    expect(summary.tone).toBe('warning');
    expect(summary.chipLabel).toBe('Sync pendiente');
    expect(summary.title).toBe('3 cambios esperando sync');
    expect(summary.bridgeStatusKind).toBe('pending_backlog');
    expect(summary.actionKind).toBe('repair_bridge');
    expect(summary.actionLabel).toBe('Re-emparejar bridge');
  });

  it('flags bridge unreachability separately from calm local-only mode when no backlog exists', () => {
    const summary = buildSettingsSyncSummary({
      isConfigured: true,
      isDeviceOnline: true,
      now: new Date('2026-04-09T10:00:00.000Z'),
      syncFacts: {
        connectionStatus: 'error',
        lastSyncAt: new Date('2026-04-09T09:00:00.000Z').getTime(),
        pendingOpsCount: 0,
        syncError: 'Bridge unreachable at http://192.168.1.10:8080',
      },
    });

    expect(summary.chipLabel).toBe('Catálogo local');
    expect(summary.bridgeStatusKind).toBe('bridge_unreachable');
    expect(summary.actionKind).toBeNull();
  });

  it('marks old pending backlog as stale so the bridge card can escalate it', () => {
    const summary = buildSettingsSyncSummary({
      isConfigured: true,
      isDeviceOnline: true,
      now: new Date('2026-04-09T10:00:00.000Z'),
      syncFacts: {
        connectionStatus: 'offline',
        lastSyncAt: new Date('2026-04-05T10:00:00.000Z').getTime(),
        pendingOpsCount: 4,
        syncError: null,
      },
    });

    expect(summary.bridgeStatusKind).toBe('stale_backlog');
    expect(summary.description).toContain('Hace 4 días');
  });

  it('builds a bridge-card warning copy when the bridge is configured but unreachable', () => {
    const bridgeStatus = buildSettingsBridgeStatus({
      chipLabel: 'Catálogo local',
      description:
        'El último intento con el bridge falló, pero tu catálogo local sigue disponible en este dispositivo.',
      title: 'Catálogo local listo',
      tone: 'default',
      bridgeStatusKind: 'bridge_unreachable',
      actionKind: null,
      actionLabel: null,
    });

    expect(bridgeStatus.chipLabel).toBe('Bridge no disponible');
    expect(bridgeStatus.title).toBe('Bridge configurado pero inaccesible');
    expect(bridgeStatus.description).toContain('último intento con el bridge falló');
    expect(bridgeStatus.tone).toBe('warning');
  });

  it('builds bridge-card copy that blames phone connectivity when the device is offline', () => {
    const bridgeStatus = buildSettingsBridgeStatus({
      chipLabel: 'Sin conexión',
      description:
        'Este teléfono está sin internet. Tus cambios siguen guardados en este dispositivo y se van a reintentar cuando vuelva la conexión.',
      title: '2 cambios esperando sync',
      tone: 'warning',
      bridgeStatusKind: 'phone_offline',
      actionKind: null,
      actionLabel: null,
    });

    expect(bridgeStatus.chipLabel).toBe('Sin conexión');
    expect(bridgeStatus.title).toBe('Teléfono sin internet');
    expect(bridgeStatus.description).toContain('teléfono está sin internet');
    expect(bridgeStatus.tone).toBe('warning');
  });
});
