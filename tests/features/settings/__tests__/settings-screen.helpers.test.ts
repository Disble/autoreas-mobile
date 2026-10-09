import {
  buildSettingsBackgroundStatus,
  buildSettingsConnection,
  resolveToneIconColor,
} from '../../../../src/features/settings/ui/SettingsScreen/settings-screen.helpers';
import type { BuildSettingsBackgroundStatusInput } from '../../../../src/features/settings/ui/SettingsScreen/settings-screen.types';

/** A paired device whose background sync is fully healthy; each test breaks one input. */
function buildHealthyInput(
  overrides: Partial<Omit<BuildSettingsBackgroundStatusInput, 'snapshot'>> & {
    readonly snapshot?: Partial<BuildSettingsBackgroundStatusInput['snapshot']>;
  } = {},
): BuildSettingsBackgroundStatusInput {
  return {
    isConfigured: overrides.isConfigured ?? true,
    isBatteryExemptionHighlighted: overrides.isBatteryExemptionHighlighted ?? false,
    snapshot: {
      registrationStatus: 'registered',
      executionMode: 'android_foreground_service',
      canShowPersistentNotification: true,
      ...overrides.snapshot,
    },
  };
}

/** Lists the ids of the issues a status reports, or an empty list when it reports none. */
function issueIds(input: BuildSettingsBackgroundStatusInput): readonly string[] {
  const status = buildSettingsBackgroundStatus(input);

  return status.kind === 'needs_attention' ? status.issues.map((issue) => issue.id) : [];
}

describe('buildSettingsBackgroundStatus', () => {
  it('collapses to a single ok line when everything works', () => {
    expect(buildSettingsBackgroundStatus(buildHealthyInput())).toEqual({ kind: 'ok' });
  });

  it('reports the background card as inactive while no PC is paired, whatever else fails', () => {
    expect(
      buildSettingsBackgroundStatus(
        buildHealthyInput({
          isConfigured: false,
          isBatteryExemptionHighlighted: true,
          snapshot: { registrationStatus: 'unregistered', canShowPersistentNotification: false },
        }),
      ),
    ).toEqual({ kind: 'inactive' });
  });

  it('reports a missing battery exemption with its request action', () => {
    const status = buildSettingsBackgroundStatus(
      buildHealthyInput({ isBatteryExemptionHighlighted: true }),
    );

    expect(status).toEqual({
      kind: 'needs_attention',
      issues: [
        {
          id: 'battery_exemption',
          title: 'El sync puede pausarse con la app cerrada',
          description:
            'Android limita la batería de esta app. Permítele funcionar en segundo plano.',
          action: { kind: 'request_battery_exemption', label: 'Permitir' },
        },
      ],
    });
  });

  it('reports a disallowed persistent notification with an open-settings action', () => {
    const status = buildSettingsBackgroundStatus(
      buildHealthyInput({ snapshot: { canShowPersistentNotification: false } }),
    );

    expect(status.kind).toBe('needs_attention');
    expect(status.kind === 'needs_attention' && status.issues).toEqual([
      expect.objectContaining({
        id: 'notification_permission',
        action: { kind: 'open_app_settings', label: 'Abrir ajustes' },
      }),
    ]);
  });

  it('ignores the persistent notification outside the foreground-service mode', () => {
    expect(
      buildSettingsBackgroundStatus(
        buildHealthyInput({
          snapshot: {
            executionMode: 'best_effort_background_task',
            canShowPersistentNotification: false,
          },
        }),
      ),
    ).toEqual({ kind: 'ok' });
  });

  it('reports a background service that is not registered with an open-settings action', () => {
    const status = buildSettingsBackgroundStatus(
      buildHealthyInput({ snapshot: { registrationStatus: 'unregistered' } }),
    );

    expect(status.kind === 'needs_attention' && status.issues).toEqual([
      expect.objectContaining({
        id: 'background_service',
        title: 'El sync automático no está activo',
        action: { kind: 'open_app_settings', label: 'Abrir ajustes' },
      }),
    ]);
  });

  it('reports an unsupported runtime alone and without an action, since nothing else applies', () => {
    const status = buildSettingsBackgroundStatus(
      buildHealthyInput({
        isBatteryExemptionHighlighted: true,
        snapshot: { registrationStatus: 'unsupported', canShowPersistentNotification: false },
      }),
    );

    expect(status.kind === 'needs_attention' && status.issues).toEqual([
      expect.objectContaining({ id: 'background_unsupported', action: null }),
    ]);
  });

  it('lists every failing item, service first, and nothing that works', () => {
    expect(
      issueIds(
        buildHealthyInput({
          isBatteryExemptionHighlighted: true,
          snapshot: { registrationStatus: 'unregistered', canShowPersistentNotification: false },
        }),
      ),
    ).toEqual(['background_service', 'battery_exemption', 'notification_permission']);
  });
});

describe('buildSettingsConnection', () => {
  it('formats the PC host and exposes this device id', () => {
    expect(
      buildSettingsConnection(true, { ip: '192.168.0.134', port: 9876, deviceId: 'device-3e4a' }),
    ).toEqual({ host: '192.168.0.134:9876', deviceId: 'device-3e4a' });
  });

  it('labels a missing ip or port instead of printing null', () => {
    expect(
      buildSettingsConnection(true, { ip: null, port: null, deviceId: 'device-3e4a' })?.host,
    ).toBe('Sin IP:Sin puerto');
  });

  it('has no connection to show while no PC is paired', () => {
    expect(buildSettingsConnection(false, null)).toBeNull();
    expect(
      buildSettingsConnection(false, { ip: '192.168.0.134', port: 9876, deviceId: 'device-3e4a' }),
    ).toBeNull();
  });
});

describe('resolveToneIconColor', () => {
  const colors = {
    accent: 'accent',
    foreground: 'foreground',
    muted: 'muted',
    success: 'success',
    warning: 'warning',
    danger: 'danger',
  };

  it.each([
    ['default', 'muted'],
    ['accent', 'accent'],
    ['success', 'success'],
    ['warning', 'warning'],
    ['danger', 'danger'],
  ] as const)('maps the %s tone to its theme color', (tone, expected) => {
    expect(resolveToneIconColor(tone, colors)).toBe(expected);
  });
});
