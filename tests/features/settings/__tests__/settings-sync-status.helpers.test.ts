import { buildSettingsSyncSummary } from '../../../../src/features/settings/ui/SettingsScreen/settings-sync-status.helpers';
import type { BuildSettingsSyncSummaryInput } from '../../../../src/features/settings/ui/SettingsScreen/settings-screen.types';

/** Fixed clock every summary in this file is derived against. */
const NOW = new Date('2026-04-09T10:00:00.000Z');
/** Milliseconds in one hour, used to place the last sync relative to `NOW`. */
const HOUR_MS = 60 * 60 * 1000;

/** Builds a paired, online summary input and lets each test override only the facts it is about. */
function buildInput(
  overrides: Partial<Omit<BuildSettingsSyncSummaryInput, 'syncFacts'>> & {
    readonly syncFacts?: Partial<BuildSettingsSyncSummaryInput['syncFacts']>;
  } = {},
): BuildSettingsSyncSummaryInput {
  return {
    isConfigured: overrides.isConfigured ?? true,
    isDeviceOnline: overrides.isDeviceOnline === undefined ? true : overrides.isDeviceOnline,
    now: overrides.now ?? NOW,
    syncFacts: {
      connectionStatus: 'unreachable',
      lastSyncAt: NOW.getTime() - 9 * HOUR_MS,
      pendingOpsCount: 0,
      ...overrides.syncFacts,
    },
  };
}

describe('buildSettingsSyncSummary', () => {
  describe('copy and tone', () => {
    it('reuses the shared visible status for the title, description and tone', () => {
      const summary = buildSettingsSyncSummary(buildInput({ syncFacts: { pendingOpsCount: 1 } }));

      expect(summary.title).toBe('Esperando a la PC');
      expect(summary.description).toBe(
        'Tienes 1 cambio guardado en este dispositivo. Se enviará solo cuando la PC esté encendida.',
      );
      expect(summary.tone).toBe('default');
    });
  });

  describe('meta line', () => {
    it('joins the last sync recency and the pending count while changes are waiting', () => {
      const summary = buildSettingsSyncSummary(buildInput({ syncFacts: { pendingOpsCount: 1 } }));

      expect(summary.meta).toBe('Último sync hace 9 h · 1 por enviar');
    });

    it('shows only the pending count when the device never synced', () => {
      const summary = buildSettingsSyncSummary(
        buildInput({ syncFacts: { lastSyncAt: null, pendingOpsCount: 4 } }),
      );

      expect(summary.meta).toBe('4 por enviar');
    });

    it('has no meta line when nothing is waiting, because the description already says when it synced', () => {
      const summary = buildSettingsSyncSummary(
        buildInput({ syncFacts: { connectionStatus: 'online', pendingOpsCount: 0 } }),
      );

      expect(summary.description).toBe('Último sync hace 9 h.');
      expect(summary.meta).toBeNull();
    });

    it('has no meta line while no PC is paired', () => {
      const summary = buildSettingsSyncSummary(
        buildInput({ isConfigured: false, syncFacts: { pendingOpsCount: 3 } }),
      );

      expect(summary.meta).toBeNull();
    });
  });

  describe('icon', () => {
    it.each([
      ['unpaired', buildInput({ isConfigured: false }), 'link-outline'],
      ['syncing', buildInput({ syncFacts: { connectionStatus: 'syncing' } }), 'sync-outline'],
      [
        'up to date',
        buildInput({ syncFacts: { connectionStatus: 'online', pendingOpsCount: 0 } }),
        'checkmark-circle-outline',
      ],
      [
        'rejected',
        buildInput({ syncFacts: { connectionStatus: 'sync_error', pendingOpsCount: 2 } }),
        'alert-circle-outline',
      ],
      ['offline device', buildInput({ isDeviceOnline: false }), 'cloud-offline-outline'],
      ['waiting for the PC', buildInput({ syncFacts: { pendingOpsCount: 1 } }), 'desktop-outline'],
    ] as const)('uses the %s icon', (_label, input, iconName) => {
      expect(buildSettingsSyncSummary(input).iconName).toBe(iconName);
    });
  });

  describe('contextual action', () => {
    it('offers pairing as the only action while no PC is paired', () => {
      const summary = buildSettingsSyncSummary(buildInput({ isConfigured: false }));

      expect(summary.action).toEqual({
        kind: 'go_to_setup',
        label: 'Emparejar PC',
        isDisabled: false,
      });
    });

    it('offers a retry while changes are waiting for the PC', () => {
      const summary = buildSettingsSyncSummary(buildInput({ syncFacts: { pendingOpsCount: 1 } }));

      expect(summary.action).toEqual({
        kind: 'sync_now',
        label: 'Reintentar ahora',
        isDisabled: false,
      });
    });

    it('offers a retry after the PC rejected the sync even with nothing counted as pending', () => {
      const summary = buildSettingsSyncSummary(
        buildInput({ syncFacts: { connectionStatus: 'sync_error', pendingOpsCount: 0 } }),
      );

      expect(summary.action?.label).toBe('Reintentar ahora');
    });

    it('offers a plain sync when everything is up to date', () => {
      const summary = buildSettingsSyncSummary(
        buildInput({ syncFacts: { connectionStatus: 'online', pendingOpsCount: 0 } }),
      );

      expect(summary.action).toEqual({
        kind: 'sync_now',
        label: 'Sincronizar ahora',
        isDisabled: false,
      });
    });

    it('disables the sync action while the device has no connection', () => {
      const summary = buildSettingsSyncSummary(
        buildInput({ isDeviceOnline: false, syncFacts: { pendingOpsCount: 2 } }),
      );

      expect(summary.action).toEqual({
        kind: 'sync_now',
        label: 'Reintentar ahora',
        isDisabled: true,
      });
    });

    it('hides the action while a sync is already running', () => {
      const summary = buildSettingsSyncSummary(
        buildInput({ syncFacts: { connectionStatus: 'syncing', pendingOpsCount: 3 } }),
      );

      expect(summary.action).toBeNull();
    });

    it('never offers re-pairing for a PC that is merely off', () => {
      const summary = buildSettingsSyncSummary(
        buildInput({
          syncFacts: { lastSyncAt: NOW.getTime() - 200 * HOUR_MS, pendingOpsCount: 5 },
        }),
      );

      expect(summary.tone).toBe('warning');
      expect(summary.action?.kind).toBe('sync_now');
    });
  });
});
