/** Provides the shared background sync task name value. */
export const BACKGROUND_SYNC_TASK_NAME = 'autoreas-background-sync';

/**
 * Scheduling options handed to `expo-background-task`.
 *
 * `minimumInterval` is expressed in **MINUTES**, not seconds. It previously read `15 * 60`,
 * written as if the unit were seconds, which asked the platform for 900 minutes -- a 15 HOUR
 * floor. Every prior design in this area assumed a 15-minute best-effort fallback existed and
 * reasoned from that assumption; it never ran. The value is a bare `15` so the unit cannot be
 * misread again, and `BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES` names the unit explicitly.
 */
export const BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES = 15;

/** Provides the shared background sync task options value. */
export const BACKGROUND_SYNC_TASK_OPTIONS = {
  minimumInterval: BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES,
} as const;
