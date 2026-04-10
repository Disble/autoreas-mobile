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
    expect(section.rows).toEqual(
      expect.arrayContaining([
        { label: 'Registro', value: 'Registrado' },
        { label: 'Último intento', value: '2026-04-10 09:10 UTC' },
        { label: 'Último éxito', value: '2026-04-10 09:05 UTC' },
        { label: 'Último fallo', value: 'Bridge timeout after 10s' },
        { label: 'Último origen', value: 'Task en segundo plano' },
        { label: 'Últimas operaciones confirmadas', value: '4' },
      ]),
    );
  });

  it('overrides the section copy for unpaired devices so the UI does not fake an active task', () => {
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
    expect(section.rows[0]).toEqual({
      label: 'Registro',
      value: 'No disponible sin bridge emparejado',
    });
  });
});
