import {
  deriveVisibleSyncStatus,
  formatLastSyncRecency,
  isManualSyncAvailableNow,
} from '../../../../src/features/sync/sync-visible-status.helpers';
import type { SyncVisibleStatusFacts } from '../../../../src/features/sync/sync-visible-status.types';

describe('sync-visible-status.helpers', () => {
  describe('formatLastSyncRecency', () => {
    const now = new Date('2026-04-09T10:00:00.000Z');
    const minuteMs = 60 * 1000;

    it.each([
      [null, null],
      [now.getTime() + minuteMs, 'hace un momento'],
      [now.getTime() - 5 * minuteMs, 'hace 5 min'],
      [now.getTime() - 60 * minuteMs, 'hace 1 h'],
      [now.getTime() - 9 * 60 * minuteMs, 'hace 9 h'],
      [now.getTime() - 24 * 60 * minuteMs, 'hace 1 día'],
      [now.getTime() - 6 * 24 * 60 * minuteMs, 'hace 6 días'],
    ])('formats a last sync at %p as %p', (lastSyncAt, expected) => {
      expect(formatLastSyncRecency(lastSyncAt, now)).toBe(expected);
    });
  });

  describe('isManualSyncAvailableNow', () => {
    it('returns false when the phone is offline', () => {
      expect(
        isManualSyncAvailableNow({
          connectionStatus: 'unreachable',
          isBridgeConfigured: true,
          isDeviceOnline: false,
          lastSyncAt: null,
          pendingOpsCount: 0,
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
        }),
      ).toBe(true);
    });
  });

  describe('deriveVisibleSyncStatus', () => {
    const NOW = new Date('2026-04-09T10:00:00.000Z');
    const HOUR_MS = 60 * 60 * 1000;

    function derive(facts: Partial<SyncVisibleStatusFacts>) {
      return deriveVisibleSyncStatus(
        {
          connectionStatus: 'unreachable',
          isBridgeConfigured: true,
          isDeviceOnline: true,
          lastSyncAt: null,
          pendingOpsCount: 0,
          ...facts,
        },
        NOW,
      );
    }

    it('reports an in-flight sync with the accent tone', () => {
      expect(derive({ connectionStatus: 'syncing', pendingOpsCount: 2 })).toEqual({
        chipLabel: 'Sincronizando',
        description: 'Enviando tus cambios a la PC.',
        title: 'Sincronizando',
        tone: 'accent',
      });
    });

    it('reports an up-to-date catalog with the last sync recency', () => {
      expect(
        derive({ connectionStatus: 'online', lastSyncAt: NOW.getTime() - 2 * 60 * 1000 }),
      ).toEqual({
        chipLabel: 'Al día',
        description: 'Último sync hace 2 min.',
        title: 'Al día',
        tone: 'success',
      });
    });

    it('reports an up-to-date catalog without recency when there is no prior sync', () => {
      expect(derive({ connectionStatus: 'online' }).description).toBe(
        'Todo lo que cambiaste ya está en la PC.',
      );
    });

    it('reserves the danger tone for a sync the PC answered and rejected', () => {
      expect(
        derive({
          connectionStatus: 'sync_error',
          lastSyncAt: NOW.getTime() - HOUR_MS,
          pendingOpsCount: 2,
        }),
      ).toEqual({
        chipLabel: 'Envío rechazado',
        description:
          'La PC respondió, pero rechazó el envío. Tus cambios siguen guardados en este dispositivo.',
        title: 'La PC no aceptó tus cambios',
        tone: 'danger',
      });
    });

    it('keeps a rejected sync in danger even with nothing pending', () => {
      expect(derive({ connectionStatus: 'sync_error', pendingOpsCount: 0 }).tone).toBe('danger');
    });

    it('keeps a calm local mode when no PC is paired and nothing is pending', () => {
      expect(derive({ connectionStatus: 'idle', isBridgeConfigured: false })).toEqual({
        chipLabel: 'Modo local',
        description:
          'La app funciona igual con tu catálogo en este dispositivo. Empareja una PC para tener una copia allí.',
        title: 'Sin PC emparejada',
        tone: 'default',
      });
    });

    it('keeps a neutral no-Wi-Fi state when the device is offline and nothing is pending', () => {
      expect(derive({ isDeviceOnline: false })).toEqual({
        chipLabel: 'Sin Wi-Fi',
        description: 'Tu catálogo sigue disponible en este dispositivo.',
        title: 'Sin Wi-Fi',
        tone: 'default',
      });
    });

    it('treats an unreachable PC with nothing pending as neutral and shows the last sync', () => {
      expect(
        derive({ lastSyncAt: NOW.getTime() - HOUR_MS }),
      ).toEqual({
        chipLabel: 'Nada por enviar',
        description: 'Último sync hace 1 h.',
        title: 'Nada por enviar',
        tone: 'default',
      });
    });

    it('says the PC has not answered yet when nothing is pending and there was never a sync', () => {
      expect(derive({}).description).toBe(
        'La PC todavía no respondió.',
      );
    });

    it('keeps pending changes neutral in local mode when no PC is paired', () => {
      expect(
        derive({ connectionStatus: 'idle', isBridgeConfigured: false, pendingOpsCount: 2 }),
      ).toEqual({
        chipLabel: 'Modo local',
        description: 'Empareja una PC para tener una copia allí.',
        title: '2 cambios guardados en este dispositivo',
        tone: 'default',
      });
    });

    it('uses singular wording for one pending change in local mode', () => {
      expect(
        derive({ connectionStatus: 'idle', isBridgeConfigured: false, pendingOpsCount: 1 }).title,
      ).toBe('1 cambio guardado en este dispositivo');
    });

    it('keeps pending changes neutral when the device is offline, even when stale', () => {
      expect(
        derive({
          isDeviceOnline: false,
          lastSyncAt: NOW.getTime() - 10 * 24 * HOUR_MS,
          pendingOpsCount: 2,
        }),
      ).toEqual({
        chipLabel: 'Sin Wi-Fi',
        description:
          'Tienes 2 cambios guardados en este dispositivo. Se enviarán cuando vuelvas a conectarte.',
        title: 'Sin Wi-Fi',
        tone: 'default',
      });
    });

    it('uses singular wording for one pending change while offline', () => {
      expect(derive({ isDeviceOnline: false, pendingOpsCount: 1 }).description).toBe(
        'Tienes 1 cambio guardado en este dispositivo. Se enviará cuando vuelvas a conectarte.',
      );
    });

    it('waits calmly for the PC while a pending backlog is younger than 72 hours', () => {
      expect(
        derive({ lastSyncAt: NOW.getTime() - (72 * HOUR_MS - 1), pendingOpsCount: 3 }),
      ).toEqual({
        chipLabel: 'Esperando a la PC',
        description:
          'Tienes 3 cambios guardados en este dispositivo. Se enviarán solos cuando la PC esté encendida.',
        title: 'Esperando a la PC',
        tone: 'default',
      });
    });

    it('waits calmly when one change is pending and there was never a sync', () => {
      expect(derive({ pendingOpsCount: 1 })).toMatchObject({
        description:
          'Tienes 1 cambio guardado en este dispositivo. Se enviará solo cuando la PC esté encendida.',
        tone: 'default',
      });
    });

    it('warns once a pending backlog reaches 72 hours without a sync', () => {
      expect(derive({ lastSyncAt: NOW.getTime() - 72 * HOUR_MS, pendingOpsCount: 2 })).toEqual({
        chipLabel: 'Esperando a la PC',
        description:
          'Tus 2 cambios siguen guardados en este dispositivo, pero la PC no los ha recibido. ¿Está encendida y en la misma red?',
        title: 'Hace 3 días que no hay sync',
        tone: 'warning',
      });
    });

    it('never escalates a long-stale backlog past warning', () => {
      const status = derive({ lastSyncAt: NOW.getTime() - 30 * 24 * HOUR_MS, pendingOpsCount: 1 });

      expect(status.tone).toBe('warning');
      expect(status.title).toBe('Hace 30 días que no hay sync');
      expect(status.description).toBe(
        'Tu cambio sigue guardado en este dispositivo, pero la PC no lo ha recibido. ¿Está encendida y en la misma red?',
      );
    });
  });
});
