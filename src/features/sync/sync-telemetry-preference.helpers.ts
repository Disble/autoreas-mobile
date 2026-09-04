/**
 * Reads the user's diagnostic-telemetry preference from the persisted bridge config.
 *
 * Three cases, deliberately distinguished:
 * - An explicit boolean is the user's own choice and is always honoured.
 * - A nullish value is ABSENCE, not a choice. The column is NOT NULL with a `true` default, so
 *   nullish only occurs on a row that predates the migration; defaulting those to off would
 *   silently mute every existing device, which is precisely the blindness this telemetry exists
 *   to remove. A device that hits the failure before anyone opens Settings must still report it.
 * - Anything else is garbage that cannot be interpreted, so it resolves to off. Guessing "on"
 *   from a corrupt value would start a transmission the user never agreed to.
 */
export function isSyncTelemetryEnabled(
  config: { isSyncTelemetryEnabled?: unknown } | null,
): boolean {
  const value = config?.isSyncTelemetryEnabled;

  if (value === null || value === undefined) {
    return true;
  }

  return value === true;
}

/**
 * Projects the user's switch position into a single-column bridge-config patch.
 * Kept separate from persistence so the decision stays pure and the hook only coordinates I/O.
 */
export function buildSyncTelemetryPreferencePatch(
  isEnabled: boolean,
): { readonly isSyncTelemetryEnabled: boolean } {
  return { isSyncTelemetryEnabled: isEnabled };
}
