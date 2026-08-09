import {
  ANIME_MUTATION_FAILURE_LABEL,
  ANIME_MUTATION_FAILURE_MAX_MESSAGE_LENGTH,
  ANIME_MUTATION_FAILURE_UNKNOWN_REASON,
  ANIME_MUTATION_STORAGE_UNAVAILABLE_DESCRIPTION,
  ANIME_MUTATION_STORAGE_UNAVAILABLE_LABEL,
} from '../../../src/features/animes/anime-mutation-failure.constants';
import {
  buildAnimeMutationFailureFeedback,
  getAnimeMutationFailureMessage,
} from '../../../src/features/animes/anime-mutation-failure.helpers';
import { EXPO_SQLITE_UNAVAILABLE_MESSAGE } from '../../../src/infrastructure/db/native-runtime/native-runtime.constants';

describe('getAnimeMutationFailureMessage', () => {
  it('prefixes the action so Settings shows which button failed', () => {
    const message = getAnimeMutationFailureMessage('capPlus', new Error('database is locked'));

    expect(message).toBe('capPlus: database is locked');
  });

  it('normalizes thrown values that are not Error instances', () => {
    expect(getAnimeMutationFailureMessage('capMinus', 'boom')).toBe('capMinus: boom');
  });

  it('falls back to the unknown reason when the message is blank', () => {
    expect(getAnimeMutationFailureMessage('capPlus', new Error('   '))).toBe(
      `capPlus: ${ANIME_MUTATION_FAILURE_UNKNOWN_REASON}`,
    );
  });

  it('truncates long messages so the Settings tile stays readable', () => {
    const message = getAnimeMutationFailureMessage('capPlus', new Error('x'.repeat(500)));

    expect(message).toHaveLength(ANIME_MUTATION_FAILURE_MAX_MESSAGE_LENGTH);
    expect(message.endsWith('…')).toBe(true);
  });
});

describe('buildAnimeMutationFailureFeedback', () => {
  it('explains the local database is not ready when SQLite is unavailable', () => {
    const feedback = buildAnimeMutationFailureFeedback(new Error(EXPO_SQLITE_UNAVAILABLE_MESSAGE));

    expect(feedback).toEqual({
      label: ANIME_MUTATION_STORAGE_UNAVAILABLE_LABEL,
      description: ANIME_MUTATION_STORAGE_UNAVAILABLE_DESCRIPTION,
    });
  });

  it('exposes the real reason for any other write failure', () => {
    const feedback = buildAnimeMutationFailureFeedback(new Error('database is locked'));

    expect(feedback).toEqual({
      label: ANIME_MUTATION_FAILURE_LABEL,
      description: 'database is locked',
    });
  });

  it('describes failures with no message using the unknown reason', () => {
    expect(buildAnimeMutationFailureFeedback(undefined).description).toBe(
      ANIME_MUTATION_FAILURE_UNKNOWN_REASON,
    );
  });

  it('caps the toast description the same way as the persisted message', () => {
    const feedback = buildAnimeMutationFailureFeedback(new Error('x'.repeat(500)));

    expect(feedback.description).toHaveLength(ANIME_MUTATION_FAILURE_MAX_MESSAGE_LENGTH);
    expect(feedback.description.endsWith('…')).toBe(true);
  });
});
