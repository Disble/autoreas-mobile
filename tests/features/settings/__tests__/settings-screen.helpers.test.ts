import {
  buildBackgroundSyncSection,
  formatBackgroundSyncTimestamp,
} from '../../../../src/features/settings/ui/SettingsScreen/settings-screen.helpers';

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
});
