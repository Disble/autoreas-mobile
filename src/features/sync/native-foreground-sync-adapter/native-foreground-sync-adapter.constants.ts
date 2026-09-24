/**
 * Notification channel id the native `SyncForegroundService` posts its ongoing notification on
 * (ODD native-foreground-sync-service T3+T5). Must stay in sync, by hand, with
 * `SyncForegroundService.CHANNEL_ID` in
 * `modules/sync-engine/android/src/main/java/expo/modules/syncengine/SyncForegroundService.kt` --
 * the same cross-module-contract shape `SYNC_FOREGROUND_SERVICE_CLASS_NAME` in
 * `SyncForegroundServiceBridge.kt` already documents. Used with `NativeForegroundServicePresence`
 * to read the live "is the service actually running right now" state for `getStatus()`. Before
 * T5 this seam checked Notifee's own channel id (`autoreas-sync-foreground`), which never matched
 * the native service's real channel; T5 fixes that mismatch by pointing this seam at the channel
 * the native service actually posts on.
 */
export const SYNC_FOREGROUND_SERVICE_CHANNEL_ID = 'autoreas-sync-foreground-native';

/**
 * Defines the interval between foreground sync attempts. T6 owns this value.
 *
 * 60_000 because:
 * - The native ticker schedules `setAndAllowWhileIdle` alarms, which are inexact and floored by
 *   the platform at roughly one delivery per minute in idle, so a 15 s request was never a
 *   cadence Android would honour.
 * - The measured tablet evidence (bridge down, T6): 125 failed attempts at one every ~10 s,
 *   each costing the full 10 s connection timeout -- a 100% duty cycle of failing attempts.
 *   An honest 60 s base interval halves the worst-case attempt frequency.
 */
export const FOREGROUND_SYNC_INTERVAL_MS = 60_000;
