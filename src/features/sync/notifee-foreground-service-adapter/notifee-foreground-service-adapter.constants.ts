/** Provides the shared notifee foreground sync channel id value. */
export const NOTIFEE_FOREGROUND_SYNC_CHANNEL_ID = 'autoreas-sync-foreground';

/**
 * Defines the interval between foreground sync cycles. T6 owns this value.
 *
 * 60_000 (was 15_000) because:
 * - The native ticker schedules `setAndAllowWhileIdle` alarms, which are inexact and floored by
 *   the platform at roughly one delivery per minute in idle, so a 15 s request was never a
 *   cadence Android would honour.
 * - The measured tablet evidence (bridge down, T6): 125 failed attempts at one every ~10 s,
 *   each costing the full 10 s connection timeout -- a 100% duty cycle of failing attempts.
 *   An honest 60 s base interval halves the worst-case attempt frequency and is the base the
 *   T6 backoff ladder (`attempt-policy.constants.ts`) expresses its `1, 2, 4, 8` multiples in.
 */
export const FOREGROUND_SYNC_INTERVAL_MS = 60_000;
