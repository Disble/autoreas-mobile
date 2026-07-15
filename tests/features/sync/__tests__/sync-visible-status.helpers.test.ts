import {
  deriveVisibleSyncStatus,
  isManualSyncAvailableNow,
} from '../../../../src/features/sync/sync-visible-status.helpers';

describe('sync-visible-status.helpers', () => {
  describe('isManualSyncAvailableNow', () => {
    it('returns false when the phone is offline', () => {
      expect(
        isManualSyncAvailableNow({
          connectionStatus: 'unreachable',
          isBridgeConfigured: true,
          isDeviceOnline: false,
          lastSyncAt: null,
          pendingOpsCount: 0,
          syncError: 'offline',
        }),
      ).toBe(false);
    });

    it('returns false when no bridge is configured', () => {
      expect(
        isManualSyncAvailableNow({
          connectionStatus: 'idle',
          isBridgeConfigured: false,
          isDeviceOnline: true,
          lastSyncAt: null,
          pendingOpsCount: 0,
          syncError: null,
        }),
      ).toBe(false);
    });

    it('returns false while a sync is already in flight', () => {
      expect(
        isManualSyncAvailableNow({
          connectionStatus: 'syncing',
          isBridgeConfigured: true,
          isDeviceOnline: true,
          lastSyncAt: null,
          pendingOpsCount: 0,
          syncError: null,
        }),
      ).toBe(false);
    });

    it('returns true when the bridge is configured, the phone is online, and retry is possible now', () => {
      expect(
        isManualSyncAvailableNow({
          connectionStatus: 'unreachable',
          isBridgeConfigured: true,
          isDeviceOnline: true,
          lastSyncAt: null,
          pendingOpsCount: 2,
          syncError: 'bridge unavailable',
        }),
      ).toBe(true);
    });
  });

  it('keeps a calm local-only state when no bridge is configured and there is no backlog', () => {
    const status = deriveVisibleSyncStatus(
      {
        connectionStatus: 'idle',
        isBridgeConfigured: false,
        isDeviceOnline: true,
        lastSyncAt: null,
        pendingOpsCount: 0,
        syncError: null,
      },
      new Date('2026-04-09T10:00:00.000Z'),
    );

    expect(status.tone).toBe('default');
    expect(status.chipLabel).toBe('Modo local');
    expect(status.title).toBe('Catálogo local listo');
    expect(status.description).toContain('No hay bridge emparejado');
  });

  it('keeps the healthy bridge-up-to-date state when the bridge is online without backlog', () => {
    const status = deriveVisibleSyncStatus(
      {
        connectionStatus: 'online',
        isBridgeConfigured: true,
        isDeviceOnline: true,
        lastSyncAt: new Date('2026-04-09T09:58:00.000Z').getTime(),
        pendingOpsCount: 0,
        syncError: null,
      },
      new Date('2026-04-09T10:00:00.000Z'),
    );

    expect(status.tone).toBe('success');
    expect(status.chipLabel).toBe('Bridge activo');
    expect(status.title).toBe('Catálogo al día');
    expect(status.description).toContain('Última sincronización');
  });

  it('distinguishes a phone-offline backlog from a bridge issue', () => {
    const status = deriveVisibleSyncStatus(
      {
        connectionStatus: 'unreachable',
        isBridgeConfigured: true,
        isDeviceOnline: false,
        lastSyncAt: new Date('2026-04-08T10:00:00.000Z').getTime(),
        pendingOpsCount: 2,
        syncError: 'Bridge unreachable at http://192.168.1.10:8080',
      },
      new Date('2026-04-09T10:00:00.000Z'),
    );

    expect(status.tone).toBe('warning');
    expect(status.chipLabel).toBe('Sin conexión');
    expect(status.title).toBe('2 cambios esperando sync');
    expect(status.description).toContain('teléfono está sin internet');
  });

  it('escalates a stale backlog when the bridge has not confirmed changes for several days', () => {
    const status = deriveVisibleSyncStatus(
      {
        connectionStatus: 'unreachable',
        isBridgeConfigured: true,
        isDeviceOnline: true,
        lastSyncAt: new Date('2026-04-03T10:00:00.000Z').getTime(),
        pendingOpsCount: 2,
        syncError: 'Bridge unreachable at http://192.168.1.10:8080',
      },
      new Date('2026-04-09T10:00:00.000Z'),
    );

    expect(status.tone).toBe('danger');
    expect(status.chipLabel).toBe('Sync pendiente');
    expect(status.title).toBe('2 cambios esperando sync');
    expect(status.description).toContain('Hace 6 días');
  });
});
