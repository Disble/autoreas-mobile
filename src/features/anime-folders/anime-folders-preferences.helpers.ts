import { sql } from 'drizzle-orm';
import type { AppDatabase } from '../../infrastructure/db/client/client.types';
import { appPreferences, type AppPreferencesRow } from '../../infrastructure/db/schema';
import { APP_PREFERENCES_SINGLETON_ID } from '../battery-exemption/battery-exemption-preferences.constants';
import type { AnimeFoldersPreferences } from './anime-folders-preferences.types';

/**
 * Projects the `app_preferences` singleton row into the anime-folders view. An absent row is the
 * state of every device before the feature, so it reads as "no root" and "hint not dismissed".
 */
export function toAnimeFoldersPreferences(
  row: Pick<AppPreferencesRow, 'animeFoldersRootUri' | 'animeFoldersHintDismissedAt'> | null | undefined,
): AnimeFoldersPreferences {
  return {
    rootUri: row?.animeFoldersRootUri ?? null,
    hintDismissedAt: row?.animeFoldersHintDismissedAt ?? null,
  };
}

/** Stores the chosen anime root, replacing any previous one and leaving every other preference. */
export async function saveAnimeFoldersRoot(db: AppDatabase, rootUri: string): Promise<void> {
  await db
    .insert(appPreferences)
    .values({ id: APP_PREFERENCES_SINGLETON_ID, animeFoldersRootUri: rootUri })
    .onConflictDoUpdate({
      target: appPreferences.id,
      set: { animeFoldersRootUri: rootUri },
    });
}

/**
 * Records that the user dismissed the hint banner. Keeps the first timestamp, like the battery
 * dialog history, so a repeated call can never move the record forward.
 */
export async function dismissAnimeFoldersHint(db: AppDatabase, now: number): Promise<void> {
  await db
    .insert(appPreferences)
    .values({ id: APP_PREFERENCES_SINGLETON_ID, animeFoldersHintDismissedAt: now })
    .onConflictDoUpdate({
      target: appPreferences.id,
      set: {
        animeFoldersHintDismissedAt: sql`coalesce(${appPreferences.animeFoldersHintDismissedAt}, excluded.anime_folders_hint_dismissed_at)`,
      },
    });
}
