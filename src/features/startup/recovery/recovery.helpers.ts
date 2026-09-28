import { decideDatabaseReset } from '../../../infrastructure/db/recovery/recovery.helpers';
import type { ResetRefusalReason } from '../../../infrastructure/db/recovery/recovery.types';
import {
  STARTUP_RECOVERY_CONFIRM_COPY,
  STARTUP_RECOVERY_DECLINED_COPY,
  STARTUP_RECOVERY_DAMAGE_COPY,
  STARTUP_RECOVERY_FAILED_COPY,
  STARTUP_RECOVERY_LAST_RESORT_COPY,
  STARTUP_RECOVERY_NO_RESET_COPY,
  STARTUP_RECOVERY_REFUSAL_DESCRIPTIONS,
  STARTUP_RECOVERY_RESET_COMPLETED_COPY,
  STARTUP_RECOVERY_RESETTING_COPY,
  STARTUP_RECOVERY_SETUP_COPY,
  STARTUP_RECOVERY_TRANSIENT_COPY,
} from './recovery.constants';
import type {
  StartupRecoveryInput,
  StartupRecoveryState,
  StartupResetAttempt,
} from './recovery.types';

/** Provides the first attempt of a fresh startup: the one that still offers the reset. */
export function createInitialStartupResetAttempt(): StartupResetAttempt {
  return { status: 'not_started' };
}

/**
 * Answers whether a transient startup failure may be retried inside this attempt.
 *
 * Two conditions, both necessary. The refusal reason must be `busy`, which is the only
 * classification whose failure is about timing instead of the database image: every other
 * classification is either physical damage (handled by the reset offer) or a state a retry cannot
 * change. The caller must also be able to mount a genuinely new provider instance, because the
 * startup provider replays its cached opening promise when the provider inputs are unchanged, so a
 * retry without a new identity re-runs no preparation at all and would only repaint the same card.
 *
 * `busy` retried on a fresh provider is the one case where the user gets a real second attempt
 * without destroying anything.
 */
export function canRetryStartupRecovery(params: {
  readonly canMountFreshProvider: boolean;
  readonly refusalReason: ResetRefusalReason;
}): boolean {
  return params.refusalReason === 'busy' && params.canMountFreshProvider;
}

/** Builds the explanatory state that carries no action at all. */
function createNoResetState(title: string, description: string): StartupRecoveryState {
  return { description, kind: 'no_reset', title };
}

/**
 * Maps one startup recovery input to the state and copy a view can render directly.
 *
 * The order below is the contract, not an implementation detail:
 *
 * 1. An in-flight, completed or failed attempt outranks the cause: whatever happened locally
 *    already happened, and reporting the old classification instead would either hide a fresh
 *    database or re-offer destruction that the attempt already spent.
 * 2. A missing cause and an unavailable Bridge are non-recovery states. Neither authorizes
 *    anything; the Bridge case simply continues to the ordinary setup screen.
 * 3. Authorization comes from `decideDatabaseReset` in the infrastructure recovery module, so
 *    confirmed corruption is the ONLY input that produces the destructive `damage` state -- this
 *    module never re-implements that decision, and no non-corruption classification can reach a
 *    reset action through any other branch.
 * 4. `busy` is presented as transient guidance with an optional retry, and every remaining
 *    refusal is presented as an explanation with no action.
 *
 * The reset offer appears exactly once per attempt because `damage` requires the `not_started`
 * attempt: a declined, in-flight, failed or completed attempt can never produce it again, and a
 * new attempt is a new provider mount or app launch.
 */
export function createStartupRecoveryState(input: StartupRecoveryInput): StartupRecoveryState {
  const { attempt, canMountFreshProvider, cause } = input;

  if (attempt.status === 'in_flight') {
    return { ...STARTUP_RECOVERY_RESETTING_COPY, kind: 'resetting' };
  }

  if (attempt.status === 'completed') {
    return { ...STARTUP_RECOVERY_RESET_COMPLETED_COPY, kind: 'reset_completed' };
  }

  if (attempt.status === 'failed') {
    return {
      ...STARTUP_RECOVERY_FAILED_COPY,
      failureReason: attempt.reason,
      kind: 'reset_failed',
      lastResort: STARTUP_RECOVERY_LAST_RESORT_COPY,
    };
  }

  if (cause === null) {
    return { kind: 'none' };
  }

  if (cause.kind === 'bridge_unavailable') {
    return { description: STARTUP_RECOVERY_SETUP_COPY.description, kind: 'setup' };
  }

  const decision = decideDatabaseReset({ classification: cause.classification });

  if (decision.outcome === 'reset') {
    if (attempt.status === 'declined') {
      return { ...STARTUP_RECOVERY_DECLINED_COPY, kind: 'no_reset' };
    }

    return {
      ...STARTUP_RECOVERY_DAMAGE_COPY,
      confirmation: STARTUP_RECOVERY_CONFIRM_COPY,
      kind: 'damage',
    };
  }

  if (decision.reason === 'busy') {
    return {
      ...STARTUP_RECOVERY_TRANSIENT_COPY,
      description: STARTUP_RECOVERY_REFUSAL_DESCRIPTIONS.busy,
      kind: 'transient',
      retryActionLabel: canRetryStartupRecovery({ canMountFreshProvider, refusalReason: decision.reason })
        ? STARTUP_RECOVERY_TRANSIENT_COPY.retryActionLabel
        : null,
    };
  }

  return createNoResetState(
    STARTUP_RECOVERY_NO_RESET_COPY.title,
    STARTUP_RECOVERY_REFUSAL_DESCRIPTIONS[decision.reason],
  );
}
