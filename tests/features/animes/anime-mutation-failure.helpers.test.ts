import {
  ANIME_MUTATION_FAILURE_LABEL,
  ANIME_MUTATION_FAILURE_MAX_MESSAGE_LENGTH,
  ANIME_MUTATION_FAILURE_UNKNOWN_REASON,
  ANIME_MUTATION_STORAGE_UNAVAILABLE_DESCRIPTION,
  ANIME_MUTATION_STORAGE_UNAVAILABLE_LABEL,
} from '../../../src/features/animes/anime-mutation-failure.constants';
import {
  buildAnimeMutationFailureFeedback,
  logLocalWriteFailureDiagnostics,
} from '../../../src/features/animes/anime-mutation-failure.helpers';
import { toLocalWriteError } from '../../../src/infrastructure/db/client/client.helpers';
import { EXPO_SQLITE_UNAVAILABLE_MESSAGE } from '../../../src/infrastructure/db/native-runtime/native-runtime.constants';

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

  it('caps the toast description so a long native payload cannot overflow it', () => {
    const feedback = buildAnimeMutationFailureFeedback(new Error('x'.repeat(500)));

    expect(feedback.description).toHaveLength(ANIME_MUTATION_FAILURE_MAX_MESSAGE_LENGTH);
    expect(feedback.description.endsWith('…')).toBe(true);
  });
});

describe('logLocalWriteFailureDiagnostics', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs the captured diagnostics of a LocalWriteError through console telemetry', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const diagnosedError = toLocalWriteError(
      new Error('database is locked'),
      Date.now() - 500,
      'commit',
    );

    logLocalWriteFailureDiagnostics('capPlus', diagnosedError);

    expect(warnSpy).toHaveBeenCalledWith(
      '[capPlus] Local write failure diagnostics',
      expect.objectContaining({ stage: 'commit' }),
    );
  });

  it('logs nothing for a plain Error, which carries no write diagnostics', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    logLocalWriteFailureDiagnostics('capPlus', new Error('database is locked'));

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('keeps the toast copy byte-identical whether the cause is a LocalWriteError or a plain Error', () => {
    const diagnosedError = toLocalWriteError(new Error('database is locked'), Date.now(), 'task');

    expect(buildAnimeMutationFailureFeedback(diagnosedError)).toEqual(
      buildAnimeMutationFailureFeedback(new Error('database is locked')),
    );
  });
});
