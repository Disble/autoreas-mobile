import { sql } from 'drizzle-orm';
import type { AppDatabase } from '../../infrastructure/db/client/client.types';
import { appPreferences, type AppPreferencesRow } from '../../infrastructure/db/schema';
import { APP_PREFERENCES_SINGLETON_ID } from './battery-exemption-preferences.constants';
import type { BatteryExemptionPreferences } from './battery-exemption-preferences.types';

/**
 * Projects the `app_preferences` singleton row into the battery-exemption view. An absent row is
 * the state of every device before the first dialog, so it reads as "never shown" for both.
 */
export function toBatteryExemptionPreferences(
  row: AppPreferencesRow | null | undefined,
): BatteryExemptionPreferences {
  return {
    promptShownAt: row?.batteryPromptShownAt ?? null,
    reminderShownAt: row?.batteryReminderShownAt ?? null,
  };
}

/**
 * Records that the first battery-exemption prompt was shown. Upserts the singleton row and keeps
 * any timestamp already stored, so a repeated call can never move the record forward and re-open
 * the reminder's silence window.
 */
export async function markBatteryPromptShown(db: AppDatabase, now: number): Promise<void> {
  await db
    .insert(appPreferences)
    .values({ id: APP_PREFERENCES_SINGLETON_ID, batteryPromptShownAt: now })
    .onConflictDoUpdate({
      target: appPreferences.id,
      set: {
        batteryPromptShownAt: sql`coalesce(${appPreferences.batteryPromptShownAt}, excluded.battery_prompt_shown_at)`,
      },
    });
}

/**
 * Records that the one-time battery-exemption reminder was shown, with the same keep-the-first
 * upsert as `markBatteryPromptShown`, and without touching the prompt timestamp.
 */
export async function markBatteryReminderShown(db: AppDatabase, now: number): Promise<void> {
  await db
    .insert(appPreferences)
    .values({ id: APP_PREFERENCES_SINGLETON_ID, batteryReminderShownAt: now })
    .onConflictDoUpdate({
      target: appPreferences.id,
      set: {
        batteryReminderShownAt: sql`coalesce(${appPreferences.batteryReminderShownAt}, excluded.battery_reminder_shown_at)`,
      },
    });
}
