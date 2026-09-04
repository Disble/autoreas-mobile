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

/**
 * Budget for one whole background reconcile cycle. Deliberately below
 * `DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS`: a stalled cycle must terminate and release its own lock
 * before the lease expires, or a second owner reclaims an expired lease while the first is
 * still running and two cycles touch one database.
 */
export const BACKGROUND_SYNC_CYCLE_DEADLINE_MS = 45_000;

/**
 * Last-resort budget for the whole `defineTask` callback, including runtime open and close.
 * The cycle's own deadline should always win; this exists only so the host is signalled even
 * when the stall is outside the cycle.
 */
export const BACKGROUND_SYNC_TASK_SIGNAL_DEADLINE_MS = 90_000;

/**
 * Documents the platform's own guarantee, not a value this app chooses. WorkManager gives a
 * worker roughly ten minutes before it is stopped; reaching that limit is what makes the host
 * kill and re-enqueue the job, which is the loop H06h describes. Every bound above sits under it.
 */
export const BACKGROUND_SYNC_HOST_RUNTIME_LIMIT_MS = 600_000;
