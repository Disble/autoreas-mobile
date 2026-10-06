/** Inputs that decide whether the first battery-exemption prompt is due. */
export interface BatteryPromptDecisionInput {
  readonly isAvailable: boolean;
  readonly isConfigured: boolean;
  readonly isExempt: boolean;
  readonly promptShownAt: number | null;
}

/** Inputs that decide whether the one-time battery-exemption reminder is due. */
export interface BatteryReminderDecisionInput extends BatteryPromptDecisionInput {
  readonly reminderShownAt: number | null;
  readonly lastAttemptAt: number | null;
  readonly now: number;
}
