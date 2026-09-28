import {
  STARTUP_RECOVERY_CONFIRM_COPY,
  STARTUP_RECOVERY_DAMAGE_COPY,
  STARTUP_RECOVERY_DECLINED_COPY,
  STARTUP_RECOVERY_FAILED_COPY,
  STARTUP_RECOVERY_LAST_RESORT_COPY,
  STARTUP_RECOVERY_SETUP_COPY,
  STARTUP_RECOVERY_TRANSIENT_COPY,
} from '../../../../src/features/startup/recovery/recovery.constants';
import {
  canRetryStartupRecovery,
  createInitialStartupResetAttempt,
  createStartupRecoveryState,
} from '../../../../src/features/startup/recovery/recovery.helpers';
import type {
  StartupRecoveryState,
  StartupResetAttempt,
} from '../../../../src/features/startup/recovery/recovery.types';
import type { StartupFailureClassification } from '../../../../src/features/startup/startup.types';

/** Names every classification that must never authorize a destructive action. */
const NON_CORRUPTION_CLASSIFICATIONS = [
  'busy',
  'incompatible_schema',
  'schema_validation',
  'sqlite',
  'unknown',
] as const;

/** Lists every attempt lifecycle this presentation has to render, in order. */
const RESET_ATTEMPTS: readonly StartupResetAttempt[] = [
  { status: 'not_started' },
  { status: 'declined' },
  { status: 'in_flight' },
  { reason: { kind: 'stage', stage: 'database_delete' }, status: 'failed' },
  { status: 'completed' },
];

/**
 * Collects every user-facing string a presentation state carries.
 *
 * Discriminants and stage names (`no_reset`, `database_prepare`) are identifiers, not copy, so
 * they are filtered out: the copy audit below must only read what a user can actually see.
 */
function collectCopy(value: unknown): string[] {
  if (typeof value === 'string') {
    return /^[a-z_]+$/.test(value) ? [] : [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectCopy(entry));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap((entry) => collectCopy(entry));
  }

  return [];
}

/** Builds the presentation for one startup failure classification. */
function createFailureState(
  classification: StartupFailureClassification,
  attempt: StartupResetAttempt = createInitialStartupResetAttempt(),
  canMountFreshProvider = false,
): StartupRecoveryState {
  return createStartupRecoveryState({
    attempt,
    canMountFreshProvider,
    cause: { classification, kind: 'startup_failure' },
  });
}

describe('startup recovery presentation', () => {
  it('offers the destructive reset for confirmed corruption alone', () => {
    const state = createFailureState('corruption');

    expect(state).toEqual({
      confirmation: {
        cancelActionLabel: expect.any(String),
        confirmActionLabel: STARTUP_RECOVERY_CONFIRM_COPY.confirmActionLabel,
        description: STARTUP_RECOVERY_CONFIRM_COPY.description,
        title: expect.any(String),
      },
      description: expect.any(String),
      kind: 'damage',
      primaryActionLabel: STARTUP_RECOVERY_DAMAGE_COPY.primaryActionLabel,
      secondaryActionLabel: STARTUP_RECOVERY_DAMAGE_COPY.secondaryActionLabel,
      title: expect.any(String),
    });
  });

  it.each(NON_CORRUPTION_CLASSIFICATIONS)(
    'refuses every destructive action when the startup failure is classified as %s',
    (classification) => {
      const state = createFailureState(classification);
      const copy = collectCopy(state).join(' ');

      expect(copy).not.toContain(STARTUP_RECOVERY_DAMAGE_COPY.primaryActionLabel);
      expect(copy).not.toContain(STARTUP_RECOVERY_CONFIRM_COPY.confirmActionLabel);
      expect(copy).not.toContain(STARTUP_RECOVERY_LAST_RESORT_COPY.actionLabel);

      if (classification === 'busy') {
        expect(state.kind).toBe('transient');
        return;
      }

      expect(state.kind).toBe('no_reset');
      expect(Object.keys(state).sort()).toEqual(['description', 'kind', 'title']);
    },
  );

  it('offers one retry for a busy failure only when the caller can mount a genuinely fresh provider', () => {
    const retryable = createFailureState('busy', createInitialStartupResetAttempt(), true);
    const notRetryable = createFailureState('busy');

    expect(retryable).toEqual({
      closeAndReopenHint: STARTUP_RECOVERY_TRANSIENT_COPY.closeAndReopenHint,
      description: expect.any(String),
      kind: 'transient',
      retryActionLabel: STARTUP_RECOVERY_TRANSIENT_COPY.retryActionLabel,
      title: expect.any(String),
    });
    expect(notRetryable).toEqual({
      closeAndReopenHint: STARTUP_RECOVERY_TRANSIENT_COPY.closeAndReopenHint,
      description: expect.any(String),
      kind: 'transient',
      retryActionLabel: null,
      title: expect.any(String),
    });
    expect(canRetryStartupRecovery({ canMountFreshProvider: true, refusalReason: 'busy' })).toBe(
      true,
    );
    expect(canRetryStartupRecovery({ canMountFreshProvider: false, refusalReason: 'busy' })).toBe(
      false,
    );
    expect(canRetryStartupRecovery({ canMountFreshProvider: true, refusalReason: 'sqlite' })).toBe(
      false,
    );
  });

  it.each(RESET_ATTEMPTS.map((attempt) => [attempt.status, attempt] as const))(
    'offers the reset exactly once per attempt, so a %s attempt never re-offers it',
    (_status, attempt) => {
      const state = createFailureState('corruption', attempt);

      expect(state.kind === 'damage').toBe(attempt.status === 'not_started');
    },
  );

  it('requires one explicit confirmation that warns unsent changes may be lost without promising the Bridge has them', () => {
    const state = createFailureState('corruption');

    expect(state.kind).toBe('damage');

    if (state.kind !== 'damage') {
      return;
    }

    expect(state.confirmation.description).toContain('pueden perderse');
    expect(state.confirmation.description).toMatch(/el Bridge no los tiene/i);
    expect(state.confirmation.description).not.toMatch(/el Bridge ya los tiene/i);
    expect(state.confirmation.confirmActionLabel).not.toBe(state.primaryActionLabel);
  });

  it('withdraws the offer when the user declines and keeps the damage explained without a destructive action', () => {
    const state = createFailureState('corruption', { status: 'declined' });

    expect(state).toEqual({
      description: STARTUP_RECOVERY_DECLINED_COPY.description,
      kind: 'no_reset',
      title: expect.any(String),
    });
    expect(collectCopy(state).join(' ')).not.toContain(
      STARTUP_RECOVERY_DAMAGE_COPY.primaryActionLabel,
    );
  });

  it('explains a failed reset with a retry and a clearly labelled last-resort action', () => {
    const state = createFailureState('corruption', {
      reason: { kind: 'stage', stage: 'database_delete' },
      status: 'failed',
    });

    expect(state).toEqual({
      description: expect.any(String),
      failureReason: { kind: 'stage', stage: 'database_delete' },
      kind: 'reset_failed',
      lastResort: {
        actionLabel: STARTUP_RECOVERY_LAST_RESORT_COPY.actionLabel,
        description: expect.any(String),
        warning: STARTUP_RECOVERY_LAST_RESORT_COPY.warning,
      },
      retryActionLabel: STARTUP_RECOVERY_FAILED_COPY.retryActionLabel,
      title: expect.any(String),
    });
    expect(STARTUP_RECOVERY_LAST_RESORT_COPY.warning).toContain('TODOS los datos');
    expect(STARTUP_RECOVERY_LAST_RESORT_COPY.warning).toContain('caché');
  });

  it.each([
    ['a refused reset', { kind: 'refused', reason: 'sqlite' }],
    ['an unexpected runner rejection', { kind: 'unexpected' }],
  ] as const)('never presents %s as a completed reset', (_label, reason) => {
    const state = createFailureState('corruption', { reason, status: 'failed' });

    expect(state.kind).toBe('reset_failed');
    expect(state).toHaveProperty('failureReason', reason);
  });

  it('maps an in-flight and a completed reset to their own states regardless of the cause', () => {
    expect(createFailureState('corruption', { status: 'in_flight' }).kind).toBe('resetting');
    expect(createFailureState('corruption', { status: 'completed' }).kind).toBe('reset_completed');
    expect(
      createStartupRecoveryState({
        attempt: { status: 'completed' },
        canMountFreshProvider: false,
        cause: null,
      }).kind,
    ).toBe('reset_completed');
  });

  it('shows nothing for a startup that did not fail and no reset for an unavailable Bridge', () => {
    expect(
      createStartupRecoveryState({
        attempt: createInitialStartupResetAttempt(),
        canMountFreshProvider: true,
        cause: null,
      }),
    ).toEqual({ kind: 'none' });
    expect(
      createStartupRecoveryState({
        attempt: createInitialStartupResetAttempt(),
        canMountFreshProvider: true,
        cause: { kind: 'bridge_unavailable' },
      }),
    ).toEqual({ description: STARTUP_RECOVERY_SETUP_COPY.description, kind: 'setup' });
  });

  it('never offers a destructive action for an unavailable Bridge', () => {
    const state = createStartupRecoveryState({
      attempt: createInitialStartupResetAttempt(),
      canMountFreshProvider: true,
      cause: { kind: 'bridge_unavailable' },
    });

    expect(collectCopy(state).join(' ')).not.toContain(
      STARTUP_RECOVERY_DAMAGE_COPY.primaryActionLabel,
    );
    expect(collectCopy(state).join(' ')).not.toContain(STARTUP_RECOVERY_LAST_RESORT_COPY.actionLabel);
  });

  it('keeps every recovery string in the app Spanish copy instead of English UI wording', () => {
    const states: StartupRecoveryState[] = [
      createFailureState('corruption'),
      createFailureState('busy', createInitialStartupResetAttempt(), true),
      ...NON_CORRUPTION_CLASSIFICATIONS.map((classification) =>
        createFailureState(classification),
      ),
      createFailureState('corruption', { status: 'declined' }),
      createFailureState('corruption', { status: 'in_flight' }),
      createFailureState('corruption', {
        reason: { kind: 'stage', stage: 'database_prepare' },
        status: 'failed',
      }),
      createFailureState('corruption', { status: 'completed' }),
      createStartupRecoveryState({
        attempt: createInitialStartupResetAttempt(),
        canMountFreshProvider: false,
        cause: { kind: 'bridge_unavailable' },
      }),
    ];
    // `error` is deliberately absent from this list: it is the same word in Spanish, unlike the
    // English UI vocabulary this guard exists to catch.
    const englishWording = /\b(reset|delete|cancel|retry|settings|database|close|failed)\b/i;

    for (const state of states) {
      const copyStrings = collectCopy(state);

      expect(copyStrings.length).toBeGreaterThan(0);

      for (const copy of copyStrings) {
        expect(copy).not.toMatch(englishWording);
      }
    }
  });
});
