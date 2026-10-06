import type { SQLiteDatabase } from 'expo-sqlite';
import { withLocalWrite } from '../../../../infrastructure/db/client/client.helpers';
import {
  markBatteryPromptShown,
  markBatteryReminderShown,
} from '../../battery-exemption-preferences.helpers';
import {
  shouldShowBatteryPrompt,
  shouldShowBatteryReminder,
} from '../../battery-exemption-decision.helpers';
import type {
  BatteryExemptionPromptVariant,
  ResolveBatteryExemptionPromptVariantInput,
} from './battery-exemption-prompt.types';

/**
 * Resolves which battery-exemption dialog is due, if any. Nothing is decided before the stored
 * state has loaded: the live queries answer empty on their first render, and reading that as
 * "never shown" would open (and record) a prompt the user already answered. The first prompt
 * takes precedence over the reminder.
 */
export function resolveBatteryExemptionPromptVariant(
  input: ResolveBatteryExemptionPromptVariantInput,
): BatteryExemptionPromptVariant | null {
  if (!input.isReady) {
    return null;
  }

  if (shouldShowBatteryPrompt(input)) {
    return 'prompt';
  }

  return shouldShowBatteryReminder(input) ? 'reminder' : null;
}

/**
 * Records that a dialog variant was shown, through the serialized local write door. A failed write
 * only means the dialog may appear once more on a later launch, so it resolves instead of
 * surfacing an error over a dialog the user is already looking at.
 */
export async function recordBatteryExemptionDialogShown(
  rawDb: SQLiteDatabase,
  variant: BatteryExemptionPromptVariant,
  shownAt: number,
): Promise<void> {
  const markShown = variant === 'prompt' ? markBatteryPromptShown : markBatteryReminderShown;

  try {
    await withLocalWrite(rawDb, (writeDb) => markShown(writeDb, shownAt));
  } catch {
    // Deliberately swallowed; see the doc comment above.
  }
}
