import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  DatabaseResetOutcome,
  DatabaseResetStage,
  ResetDecisionInput,
  ResetRefusalReason,
} from '../../../infrastructure/db/recovery';
import type { StartupFailureClassification } from '../startup.types';

/**
 * Names the startup situation this recovery layer reasons about.
 *
 * `startup_failure` carries the startup diagnostic's own classification, which is the only input
 * the destructive authorization reads. `bridge_unavailable` is the ordinary first-run state: no
 * Bridge is configured, the app continues to setup, and nothing here is destructive. Neither
 * member can authorize a reset on its own -- the reset decision in the infrastructure recovery
 * module does, and it authorizes confirmed corruption alone.
 */
export type StartupRecoveryCause =
  | {
      readonly kind: 'startup_failure';
      readonly classification: StartupFailureClassification;
    }
  | { readonly kind: 'bridge_unavailable' };

/**
 * Names why a reset attempt stopped without completing.
 *
 * The startup feature does not decide these; it carries them so a failure stays diagnosable
 * without ever holding a raw error -- a port rejection can carry a file path or a SQL statement.
 * `stage` is the orchestrator's own ordered stage, `refused` is its refusal vocabulary, and
 * `unexpected` is a runner that rejected instead of reporting one of the two, which must never be
 * presented as a completed reset.
 */
export type StartupResetFailureReason =
  | { readonly kind: 'stage'; readonly stage: DatabaseResetStage }
  | { readonly kind: 'refused'; readonly reason: ResetRefusalReason }
  | { readonly kind: 'unexpected' };

/**
 * Tracks the reset lifecycle of ONE startup attempt.
 *
 * The attempt is monotonic on purpose: `not_started` is the only status that still offers the
 * reset, so a destructive offer cannot be re-presented inside the same attempt whether the user
 * declined it, it is in flight, it failed, or it completed. `declined`, `failed` and `completed`
 * are terminal for the offer; a new attempt is a new provider mount or app launch, which is what
 * the declined copy tells the user to do.
 */
export type StartupResetAttempt =
  | { readonly status: 'not_started' }
  | { readonly status: 'declined' }
  | { readonly status: 'in_flight' }
  | { readonly status: 'failed'; readonly reason: StartupResetFailureReason }
  | { readonly status: 'completed' };

/** Defines the single destructive confirmation the user must answer before any reset runs. */
export interface StartupResetConfirmation {
  /** Provides the confirmation title. */
  readonly title: string;
  /** States what is destroyed and that unsent changes may be lost. */
  readonly description: string;
  /** Labels the action that confirms destruction. */
  readonly confirmActionLabel: string;
  /** Labels the action that dismisses the confirmation without destroying anything. */
  readonly cancelActionLabel: string;
}

/** Defines the clearly labelled last-resort action offered after a failed reset. */
export interface StartupRecoveryLastResort {
  /** Labels the action that opens the Android application settings. */
  readonly actionLabel: string;
  /** Explains when to reach for the manual path. */
  readonly description: string;
  /** Warns what clearing the application storage destroys and what it does not repair. */
  readonly warning: string;
}

/**
 * Defines the presentation of one startup recovery state, copy included.
 *
 * Every member is renderable as-is, so the view layer stays dumb and cannot invent an action the
 * logic never authorized. `damage` is the only member that carries a destructive action, and it is
 * produced for confirmed corruption alone; `no_reset` carries an explanation with no action at
 * all, which is what makes "no destructive action" checkable instead of merely intended.
 */
export type StartupRecoveryState =
  | { readonly kind: 'none' }
  | { readonly kind: 'setup'; readonly description: string }
  | {
      readonly kind: 'damage';
      readonly title: string;
      readonly description: string;
      readonly primaryActionLabel: string;
      readonly secondaryActionLabel: string;
      readonly confirmation: StartupResetConfirmation;
    }
  | {
      readonly kind: 'transient';
      readonly title: string;
      readonly description: string;
      readonly closeAndReopenHint: string;
      readonly retryActionLabel: string | null;
    }
  | { readonly kind: 'no_reset'; readonly title: string; readonly description: string }
  | { readonly kind: 'resetting'; readonly title: string; readonly description: string }
  | {
      readonly kind: 'reset_failed';
      readonly title: string;
      readonly description: string;
      readonly retryActionLabel: string;
      readonly failureReason: StartupResetFailureReason;
      readonly lastResort: StartupRecoveryLastResort;
    }
  | { readonly kind: 'reset_completed'; readonly title: string; readonly description: string };

/** Defines the pure input the recovery presentation reads. */
export interface StartupRecoveryInput {
  /** Carries the current attempt lifecycle, which decides whether the offer is still available. */
  readonly attempt: StartupResetAttempt;
  /**
   * Reports whether the caller can mount a genuinely NEW provider instance.
   *
   * The startup provider runs its preparation once per provider input identity: `expo-sqlite`'s
   * suspense provider caches its open promise per `databaseName`/`directory`/`options`/`onInit`
   * (`node_modules/expo-sqlite/build/hooks.js`), so re-rendering the same instance re-runs nothing
   * and would leave the user pressing a button that does no work. A retry is therefore offered
   * only when the caller says it can supply a new identity.
   */
  readonly canMountFreshProvider: boolean;
  /** Carries the situation to present, or `null` when startup did not fail at all. */
  readonly cause: StartupRecoveryCause | null;
}

/** Defines the properties the startup recovery hook consumes. */
export interface UseStartupRecoveryProps {
  /** Carries the situation to present, or `null` when startup did not fail at all. */
  readonly cause: StartupRecoveryCause | null;
  /**
   * Supplies the connection the provider opened, or `null` when none is open.
   *
   * Defaults to the provider context, which is `null` whenever the recovery surface renders
   * outside `SQLiteProvider` -- exactly the current composition, where the failure card replaces
   * the provider. `expo-sqlite` refuses to delete a database that still has a cached connection
   * (`SQLiteModule.kt` throws `DeleteDatabaseException`), so the caller that owns `onInit` must
   * hand the handle over for an in-session reset to delete anything.
   */
  readonly getActiveDatabase?: () => SQLiteDatabase | null;
  /** Overrides the last-resort app-settings opener; the default opens the platform settings. */
  readonly openAppSettings?: () => Promise<void>;
  /**
   * Asks the caller to mount a genuinely new provider instance, or is absent when it cannot.
   *
   * Supplying it is the caller's assertion that the next provider gets a new input identity (for
   * example a new `onInit` reference), which is what makes `expo-sqlite` reopen the database
   * instead of replaying its cached opening promise.
   */
  readonly remountProvider?: () => void;
  /** Overrides the reset runner; the default orchestrates the production adapters. */
  readonly runDatabaseReset?: (input: ResetDecisionInput) => Promise<DatabaseResetOutcome>;
}

/** Defines the state and actions the startup recovery logic exposes to its caller. */
export interface UseStartupRecoveryResult {
  /** Declines the offer for this attempt; the reset is not offered again until a new attempt. */
  readonly cancelReset: () => void;
  /** Runs the confirmed reset; it does nothing without a visible confirmation. */
  readonly confirmReset: () => Promise<void>;
  /** Reports whether the destructive confirmation is currently open. */
  readonly isResetConfirmationVisible: boolean;
  /** Opens the Android application settings for the last-resort manual path. */
  readonly openAppSettings: () => Promise<void>;
  /** Carries the renderable presentation of the current recovery state. */
  readonly recoveryState: StartupRecoveryState;
  /** Opens the destructive confirmation for a confirmed corruption failure. */
  readonly requestReset: () => void;
  /** Retries a failed reset, resuming the durable intent the previous attempt wrote. */
  readonly retryReset: () => Promise<void>;
  /** Retries a transient startup failure on a genuinely fresh provider. */
  readonly retryStartup: () => void;
}
