import type { SyncExecutionMode } from './sync-execution-mode.types';

/**
 * Closed vocabulary of decisions the pure resolver can reach. Each answers a different question
 * about the FGS watchdog's job on a headless wake:
 * - `not_configured` -- the app is not supposed to be in foreground-service mode at all, so
 *   there is nothing to watch.
 * - `already_running` -- the native presence check confirms the service is up; no restore.
 * - `blocked_not_exempt` -- the service is down, but starting it from the background would
 *   throw `ForegroundServiceStartNotAllowedException` without the battery-optimization
 *   exemption, so a restore must not even be attempted.
 * - `restore` -- the service is down, the app is exempt, and restoring is both warranted and
 *   legal.
 */
export type ForegroundServiceWatchdogDecision =
  | 'not_configured'
  | 'already_running'
  | 'blocked_not_exempt'
  | 'restore';

/**
 * Inputs the pure decision function needs, all already resolved by the caller. Deliberately flat
 * data in, data out -- no SQLite, no Notifee, no native module lookups -- so the decision logic
 * is testable without mocking any collaborator.
 */
export interface ResolveForegroundServiceWatchdogDecisionParams {
  /** Persisted `sync_runtime_status.executionMode` -- is the app supposed to be in FGS mode. */
  readonly executionMode: SyncExecutionMode;
  /** Native `NotificationManager`-backed presence check -- is the service actually up right now. */
  readonly isForegroundServiceRunning: boolean;
  /** Native battery-optimization exemption state -- is a background restore legal at all. */
  readonly isExempt: boolean;
}

/**
 * Terminal, always-recordable outcome the effectful watchdog run resolves to. Mirrors
 * `ForegroundServiceWatchdogDecision` one for one, except `restore` (an intent) splits into
 * `restored` / `restore_failed` (a result) once the effectful restore attempt actually runs, and
 * `watchdog_error` covers any unexpected failure outside that specific attempt (e.g. reading the
 * persisted snapshot, or a native seam throwing instead of degrading) -- the watchdog's own
 * never-throw contract means every code path resolves to one of these, never a rejection.
 */
export type ForegroundServiceWatchdogOutcome =
  | 'not_configured'
  | 'already_running'
  | 'blocked_not_exempt'
  | 'restored'
  | 'restore_failed'
  | 'watchdog_error';
