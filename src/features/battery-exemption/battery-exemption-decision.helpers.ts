import { BACKGROUND_SILENCE_THRESHOLD_MS } from './battery-exemption-decision.constants';
import type {
  BatteryPromptDecisionInput,
  BatteryReminderDecisionInput,
} from './battery-exemption-decision.types';

/** True when the exemption can be requested on this device and is still missing. */
function isExemptionRequestable(input: BatteryPromptDecisionInput): boolean {
  return input.isAvailable && input.isConfigured && !input.isExempt;
}

/**
 * Decides whether the first battery-exemption prompt is due: the native seam exists (Android
 * build), the bridge is paired, the app is not exempt yet, and the prompt was never shown.
 */
export function shouldShowBatteryPrompt(input: BatteryPromptDecisionInput): boolean {
  return isExemptionRequestable(input) && input.promptShownAt === null;
}

/**
 * Decides whether the one-time reminder is due: the user saw and declined the first prompt, is
 * still not exempt, has never seen the reminder, and background sync has recorded no attempt for
 * `BACKGROUND_SILENCE_THRESHOLD_MS`. The same window must also have passed since the prompt, so
 * a device that was already silent when the prompt appeared is not reminded straight away. A
 * missing `lastAttemptAt` is no evidence of a stop (the service may never have started), so it
 * never triggers the reminder.
 */
export function shouldShowBatteryReminder(input: BatteryReminderDecisionInput): boolean {
  const { promptShownAt, reminderShownAt, lastAttemptAt, now } = input;

  if (!isExemptionRequestable(input) || reminderShownAt !== null) {
    return false;
  }

  if (promptShownAt === null || lastAttemptAt === null) {
    return false;
  }

  return (
    now - lastAttemptAt >= BACKGROUND_SILENCE_THRESHOLD_MS &&
    now - promptShownAt >= BACKGROUND_SILENCE_THRESHOLD_MS
  );
}
