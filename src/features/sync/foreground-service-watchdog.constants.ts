/**
 * Nominal budget for one whole FGS watchdog check, wrapping the call the way
 * `resolveBackgroundTaskOutcome`'s own deadline wraps the sync cycle. **This bound is NOT
 * effective on the headless `expo-background-task` path the watchdog actually runs on, and it
 * must not be trusted to rescue a hang there.** Device-confirmed 2026-09-04 (see the
 * `background-timers-paused-headless` finding): RN's `JavaTimerManager` stops driving `setTimeout`
 * once the Activity is paused, and `expo-task-manager`'s `TaskService.java` keep-alive workaround
 * only re-registers on the first event of `sEvents` -- a cycle that never signals leaves its
 * eventId in `sEvents` forever, so every later cycle's `isFirstEvent` is `false` and its timers
 * never run either. `withDeadline`, `setTimeout`, and every other JS-level bound in this repo fail
 * SIMULTANEOUSLY in that state; none of them is more trustworthy than another.
 *
 * It stays declared, and `runForegroundServiceWatchdog` still wraps its work in it, because it is
 * real and useful in a foreground/live-timer context and harmless everywhere else -- just not a
 * guarantee on the one path that matters here. The actual protections on the headless path are
 * structural, not timer-based: `background-sync.task.ts` never awaits
 * `runForegroundServiceWatchdog`, so a hang inside it (most plausibly `adapter.register()`, which
 * can hang per the ordering note in `notifee-foreground-service-adapter.helpers.ts`) cannot stall
 * the task's own `CompletableDeferred`; and every SQLite await this watchdog makes is bounded by
 * `busy_timeout`, enforced natively inside SQLite independent of the JS event loop (see
 * `sync-diagnostics-outbox.constants.ts` for the same reasoning applied elsewhere).
 *
 * **Do not "fix" a future background hang by adding another `setTimeout`-based bound here or
 * anywhere else on this path.** It will look correct in a foreground test and do nothing in the
 * one context it needs to work. Only a native bound (SQLite's `busy_timeout`, or not awaiting at
 * all) fires reliably once JS timers are paused.
 */
export const FOREGROUND_SERVICE_WATCHDOG_DEADLINE_MS = 20_000;
