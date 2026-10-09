import {
  SETTINGS_BACKGROUND_ISSUES,
  SETTINGS_CONNECTION_COPY,
} from './settings-screen.constants';
import type {
  BuildSettingsBackgroundStatusInput,
  ResolvedToneColors,
  SettingsBackgroundIssue,
  SettingsBackgroundStatus,
  SettingsConnection,
  SettingsConnectionConfig,
  SettingsTone,
} from './settings-screen.types';

/**
 * Derives what the background card shows from the runtime snapshot and the battery exemption.
 * Inactive while no PC is paired; one ok line when everything works; otherwise only the failing
 * items, each with its fix. An unsupported runtime is reported alone, since no other fix applies.
 * The persistent notification only matters in the foreground-service mode, the one that posts it.
 */
export function buildSettingsBackgroundStatus({
  isConfigured,
  isBatteryExemptionHighlighted,
  snapshot,
}: BuildSettingsBackgroundStatusInput): SettingsBackgroundStatus {
  if (!isConfigured) {
    return { kind: 'inactive' };
  }

  if (snapshot.registrationStatus === 'unsupported') {
    return { kind: 'needs_attention', issues: [SETTINGS_BACKGROUND_ISSUES.background_unsupported] };
  }

  const issues: SettingsBackgroundIssue[] = [];

  if (snapshot.registrationStatus === 'unregistered') {
    issues.push(SETTINGS_BACKGROUND_ISSUES.background_service);
  }

  if (isBatteryExemptionHighlighted) {
    issues.push(SETTINGS_BACKGROUND_ISSUES.battery_exemption);
  }

  if (
    snapshot.executionMode === 'android_foreground_service' &&
    !snapshot.canShowPersistentNotification
  ) {
    issues.push(SETTINGS_BACKGROUND_ISSUES.notification_permission);
  }

  return issues.length === 0 ? { kind: 'ok' } : { kind: 'needs_attention', issues };
}

/**
 * Builds the connection card's host and device id, or null while no PC is paired so the card
 * is hidden instead of rendering an empty pairing.
 */
export function buildSettingsConnection(
  isConfigured: boolean,
  config: SettingsConnectionConfig | null,
): SettingsConnection | null {
  if (!isConfigured || !config?.deviceId) {
    return null;
  }

  const ip = config.ip ?? SETTINGS_CONNECTION_COPY.missingIp;
  const port = config.port ?? SETTINGS_CONNECTION_COPY.missingPort;

  return { host: `${ip}:${port}`, deviceId: config.deviceId };
}

/** Resolves the theme color a tone tints the status icon with; calm states use the muted color. */
export function resolveToneIconColor(tone: SettingsTone, colors: ResolvedToneColors): string {
  switch (tone) {
    case 'accent':
      return colors.accent;
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'danger':
      return colors.danger;
    default:
      return colors.muted;
  }
}
