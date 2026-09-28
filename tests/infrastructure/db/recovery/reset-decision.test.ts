import type { StartupFailureClassification } from '../../../../src/features/startup/startup.types';
import {
  decideDatabaseReset,
  type ResetDecisionInput,
  type ResetDiagnosticClassification,
} from '../../../../src/infrastructure/db/recovery';

/** Proves two unions accept exactly one another's members, in both directions. */
type MutuallyAssignable<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;

/**
 * Compile-time parity guard. If the startup diagnostic gains, loses, or renames a
 * classification without this module following, one of the two directions fails to typecheck and
 * the flag below stops being `true`.
 */
const classificationParity: MutuallyAssignable<
  StartupFailureClassification,
  ResetDiagnosticClassification
> = true;

/** The only input that may authorize a reset: confirmed physical corruption. */
const authorizedInput: ResetDecisionInput = {
  classification: 'corruption',
};

describe('database reset decision', () => {
  it('keeps the same refusal vocabulary the startup diagnostic publishes', () => {
    const startupClassification: StartupFailureClassification = 'corruption';

    expect(classificationParity).toBe(true);
    expect(decideDatabaseReset({ classification: startupClassification })).toEqual({
      outcome: 'reset',
      reason: 'confirmed_corruption',
    });
  });

  it('authorizes a reset for confirmed corruption alone', () => {
    expect(decideDatabaseReset(authorizedInput)).toEqual({
      outcome: 'reset',
      reason: 'confirmed_corruption',
    });
  });

  it.each(['busy', 'unknown', 'schema_validation', 'incompatible_schema', 'sqlite'] as const)(
    'refuses an unconfirmed failure classified as %s with that exact reason',
    (classification) => {
      expect(decideDatabaseReset({ classification })).toEqual({
        outcome: 'refuse',
        reason: classification,
      });
    },
  );

  // Correction (parent review): the Bridge and the stored configuration are NOT reset
  // prerequisites. The user resets the damaged local database first; if the Bridge is off the app
  // simply stays in setup, and pairing/snapshot happen AFTER the reset. These inputs carry the old
  // prerequisite fields at runtime to prove the decision ignores them rather than consulting them.
  it.each([
    ['the Bridge offline', { classification: 'corruption', isBridgeAvailable: false }],
    ['no stored configuration', { classification: 'corruption', isConfigurationPresent: false }],
    [
      'both the Bridge offline and no stored configuration',
      { classification: 'corruption', isBridgeAvailable: false, isConfigurationPresent: false },
    ],
  ])('authorizes a reset for confirmed corruption with %s', (_label, input) => {
    expect(decideDatabaseReset(input as unknown as ResetDecisionInput)).toEqual({
      outcome: 'reset',
      reason: 'confirmed_corruption',
    });
  });

  it('lets no caller-supplied override turn a refusal into a reset', () => {
    const forcedInput = {
      classification: 'busy',
      isBridgeAvailable: true,
      isConfigurationPresent: true,
      force: true,
      confirmedByUser: true,
      authorized: true,
    } as unknown as ResetDecisionInput;

    expect(decideDatabaseReset(forcedInput)).toEqual({ outcome: 'refuse', reason: 'busy' });
  });
});
