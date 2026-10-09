import {
  buildSettingsBridgeStatus,
  buildSettingsSyncSummary,
} from '../../../../src/features/settings/ui/SettingsScreen/settings-sync-status.helpers';

/**
 * Split from `settings-screen.helpers.test.ts` (CLAUDE.md #5, the 500-line rule): this file owns
 * `buildSettingsSyncSummary`/`buildSettingsBridgeStatus`; the sibling file owns
 * `buildBackgroundSyncSection`/`formatBackgroundSyncTimestamp`.
 */
describe('settings-sync-status.helpers', () => {
  it('builds a calm local-only summary with setup guidance when no bridge is paired', () => {
    const summary = buildSettingsSyncSummary({
      isConfigured: false,
      isDeviceOnline: true,
      now: new Date('2026-04-09T10:00:00.000Z'),
      syncFacts: {
        connectionStatus: 'idle',
        lastSyncAt: null,
        pendingOpsCount: 0,
        syncError: null,
      },
    });

    expect(summary.tone).toBe('default');
    expect(summary.chipLabel).toBe('Modo local');
    expect(summary.title).toBe('Sin PC emparejada');
    expect(summary.description).toContain('Empareja una PC');
    expect(summary.bridgeStatusKind).toBe('unpaired');
    expect(summary.actionKind).toBe('go_to_setup');
    expect(summary.actionLabel).toBe('Emparejar PC');
  });

  it('keeps device-offline pending changes neutral and without an action', () => {
    const summary = buildSettingsSyncSummary({
      isConfigured: true,
      isDeviceOnline: false,
      now: new Date('2026-04-09T10:00:00.000Z'),
      syncFacts: {
        connectionStatus: 'unreachable',
        lastSyncAt: new Date('2026-04-08T10:00:00.000Z').getTime(),
        pendingOpsCount: 2,
        syncError: 'Bridge unreachable at http://192.168.1.10:9876',
      },
    });

    expect(summary.tone).toBe('default');
    expect(summary.chipLabel).toBe('Sin Wi-Fi');
    expect(summary.title).toBe('Sin Wi-Fi');
    expect(summary.description).toContain('vuelvas a conectarte');
    expect(summary.bridgeStatusKind).toBe('phone_offline');
    expect(summary.actionKind).toBeNull();
    expect(summary.actionLabel).toBeNull();
  });

  it('never suggests re-pairing when the PC is merely unreachable with a pending backlog', () => {
    const summary = buildSettingsSyncSummary({
      isConfigured: true,
      isDeviceOnline: true,
      now: new Date('2026-04-09T10:00:00.000Z'),
      syncFacts: {
        connectionStatus: 'unreachable',
        lastSyncAt: new Date('2026-04-08T10:00:00.000Z').getTime(),
        pendingOpsCount: 3,
        syncError: 'Bridge unreachable at http://192.168.1.10:9876',
      },
    });

    expect(summary.tone).toBe('default');
    expect(summary.chipLabel).toBe('Esperando a la PC');
    expect(summary.title).toBe('Esperando a la PC');
    expect(summary.bridgeStatusKind).toBe('bridge_unreachable');
    expect(summary.actionKind).toBeNull();
    expect(summary.actionLabel).toBeNull();
  });

  it('flags bridge unreachability separately from calm local-only mode when no backlog exists', () => {
    const summary = buildSettingsSyncSummary({
      isConfigured: true,
      isDeviceOnline: true,
      now: new Date('2026-04-09T10:00:00.000Z'),
      syncFacts: {
        connectionStatus: 'unreachable',
        lastSyncAt: new Date('2026-04-09T09:00:00.000Z').getTime(),
        pendingOpsCount: 0,
        syncError: 'Bridge unreachable at http://192.168.1.10:9876',
      },
    });

    expect(summary.tone).toBe('default');
    expect(summary.chipLabel).toBe('Nada por enviar');
    expect(summary.bridgeStatusKind).toBe('bridge_unreachable');
    expect(summary.actionKind).toBeNull();
  });

  it('presents a reachable sync rejection without blaming bridge connectivity', () => {
    const summary = buildSettingsSyncSummary({
      isConfigured: true,
      isDeviceOnline: true,
      now: new Date('2026-04-09T10:00:00.000Z'),
      syncFacts: {
        connectionStatus: 'sync_error',
        lastSyncAt: new Date('2026-04-09T09:00:00.000Z').getTime(),
        pendingOpsCount: 2,
        syncError: 'Reconcile failed: 422',
      },
    });
    const bridgeStatus = buildSettingsBridgeStatus(summary);

    expect(summary.bridgeStatusKind).toBe('sync_error');
    expect(summary.tone).toBe('danger');
    expect(summary.title).toBe('La PC no aceptó tus cambios');
    expect(summary.actionKind).toBeNull();
    expect(bridgeStatus.chipLabel).toBe('Bridge disponible');
    expect(bridgeStatus.title).toBe('El bridge rechazó el sync');
    expect(bridgeStatus.description).toContain('respondió, pero no pudo completar');
    expect(bridgeStatus.tone).toBe('danger');
  });

  it('marks old pending backlog as stale so the bridge card can escalate it', () => {
    const summary = buildSettingsSyncSummary({
      isConfigured: true,
      isDeviceOnline: true,
      now: new Date('2026-04-09T10:00:00.000Z'),
      syncFacts: {
        connectionStatus: 'idle',
        lastSyncAt: new Date('2026-04-05T10:00:00.000Z').getTime(),
        pendingOpsCount: 4,
        syncError: null,
      },
    });

    expect(summary.bridgeStatusKind).toBe('stale_backlog');
    expect(summary.tone).toBe('warning');
    expect(summary.title).toBe('Hace 4 días que no hay sync');
    expect(summary.description).toContain('la PC no los ha recibido');
    expect(summary.actionKind).toBeNull();
  });

  it('keeps a pending backlog younger than 72 hours out of the stale kind', () => {
    const summary = buildSettingsSyncSummary({
      isConfigured: true,
      isDeviceOnline: true,
      now: new Date('2026-04-09T10:00:00.000Z'),
      syncFacts: {
        connectionStatus: 'idle',
        lastSyncAt: new Date('2026-04-06T11:00:00.000Z').getTime(),
        pendingOpsCount: 4,
        syncError: null,
      },
    });

    expect(summary.bridgeStatusKind).toBe('pending_backlog');
    expect(summary.tone).toBe('default');
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
