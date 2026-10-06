/** Records when each battery-exemption dialog variant was shown; `null` means never. */
export interface BatteryExemptionPreferences {
  readonly promptShownAt: number | null;
  readonly reminderShownAt: number | null;
}
