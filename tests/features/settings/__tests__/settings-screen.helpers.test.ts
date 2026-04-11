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
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775811900000,
        lastFailureMessage: 'Bridge timeout after 10s',
        lastTriggerSource: 'background_task',
        lastSyncedCount: 4,
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
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775811900000,
        lastFailureMessage: null,
        lastTriggerSource: 'app_active',
        lastSyncedCount: 12,
      },
    });

    expect(section.statusTone).toBe('success');
    expect(section.title).toBe('Sync en segundo plano operativo');
    expect(section.tiles.find((tile) => tile.id === 'lastFailure')).toBeUndefined();
    expect(section.tiles.map((tile) => tile.id)).toEqual([
      'registration',
      'lastAttempt',
      'lastSuccess',
      'lastTrigger',
      'syncedCount',
    ]);
  });

  it('emits only a single "not available" tile when the bridge is not paired', () => {
    const section = buildBackgroundSyncSection({
      isConfigured: false,
      snapshot: {
        registrationStatus: 'registered',
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775812200000,
        lastFailureMessage: null,
        lastTriggerSource: 'manual',
        lastSyncedCount: 0,
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
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureMessage: null,
        lastTriggerSource: null,
        lastSyncedCount: 0,
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
