import {
  RESET_INTENT_REASON_CONFIRMED_CORRUPTION,
  RESET_INTENT_REASONS,
  RESET_PROTECTED_DATABASE_NAMES,
  RESET_TARGET_DATABASE_NAME,
  ResetIntentSchema,
  parseResetIntent,
} from '../../../../src/infrastructure/db/recovery';

describe('reset intent payload', () => {
  it('round-trips a reason code and a timestamp and carries nothing else', () => {
    const parsed = parseResetIntent({
      reason: RESET_INTENT_REASON_CONFIRMED_CORRUPTION,
      requestedAt: 1_700_000_000_000,
    });

    expect(parsed).toEqual({
      reason: 'confirmed_corruption',
      requestedAt: 1_700_000_000_000,
    });
    expect(Object.keys(parsed ?? {}).sort()).toEqual(['reason', 'requestedAt']);
  });

  it('exposes a closed, single-member reason vocabulary', () => {
    expect(RESET_INTENT_REASONS).toEqual(['confirmed_corruption']);
    expect(ResetIntentSchema.safeParse({ reason: 'confirmed_corruption', requestedAt: 1 }).success).toBe(
      true,
    );
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a bare string', 'confirmed_corruption'],
    ['a number', 42],
    ['an empty array', []],
    ['an empty object', {}],
    ['a record without a reason', { requestedAt: 1 }],
    ['a record without a timestamp', { reason: 'confirmed_corruption' }],
    ['an unknown reason code', { reason: 'user_requested', requestedAt: 1 }],
    ['a negative timestamp', { reason: 'confirmed_corruption', requestedAt: -1 }],
    ['a fractional timestamp', { reason: 'confirmed_corruption', requestedAt: 1.5 }],
    ['a string timestamp', { reason: 'confirmed_corruption', requestedAt: '1' }],
    [
      'a foreign record carrying personal data',
      { reason: 'confirmed_corruption', requestedAt: 1, deviceId: 'abc', email: 'a@b.c' },
    ],
    ['a record carrying any extra key', { reason: 'confirmed_corruption', requestedAt: 1, userId: 7 }],
  ])('treats %s as absent rather than trusting it', (_label, raw) => {
    expect(parseResetIntent(raw)).toBeNull();
  });

  it('names only the application database as the reset target', () => {
    expect(RESET_TARGET_DATABASE_NAME).toBe('autoreas.db');
    expect(RESET_PROTECTED_DATABASE_NAMES).toEqual(['autoreas-telemetry.db', 'sync-journal.db']);
    expect(RESET_PROTECTED_DATABASE_NAMES).not.toContain(RESET_TARGET_DATABASE_NAME);
  });
});
