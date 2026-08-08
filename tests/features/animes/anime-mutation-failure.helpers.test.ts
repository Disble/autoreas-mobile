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
  it('prefija la accion para distinguir cual boton fallo en Configuracion', () => {
    const message = getAnimeMutationFailureMessage('capPlus', new Error('database is locked'));

    expect(message).toBe('capPlus: database is locked');
  });

  it('normaliza valores lanzados que no son Error', () => {
    expect(getAnimeMutationFailureMessage('capMinus', 'boom')).toBe('capMinus: boom');
  });

  it('usa la razon desconocida cuando el mensaje viene vacio', () => {
    expect(getAnimeMutationFailureMessage('capPlus', new Error('   '))).toBe(
      `capPlus: ${ANIME_MUTATION_FAILURE_UNKNOWN_REASON}`,
    );
  });

  it('trunca mensajes largos para que la tile de Configuracion siga siendo legible', () => {
    const message = getAnimeMutationFailureMessage('capPlus', new Error('x'.repeat(500)));

    expect(message).toHaveLength(ANIME_MUTATION_FAILURE_MAX_MESSAGE_LENGTH);
    expect(message.endsWith('…')).toBe(true);
  });
});

describe('buildAnimeMutationFailureFeedback', () => {
  it('explica que la base local no esta lista cuando SQLite no esta disponible', () => {
    const feedback = buildAnimeMutationFailureFeedback(new Error(EXPO_SQLITE_UNAVAILABLE_MESSAGE));

    expect(feedback).toEqual({
      label: ANIME_MUTATION_STORAGE_UNAVAILABLE_LABEL,
      description: ANIME_MUTATION_STORAGE_UNAVAILABLE_DESCRIPTION,
    });
  });

  it('expone la razon real para cualquier otro fallo de escritura', () => {
    const feedback = buildAnimeMutationFailureFeedback(new Error('database is locked'));

    expect(feedback).toEqual({
      label: ANIME_MUTATION_FAILURE_LABEL,
      description: 'database is locked',
    });
  });

  it('describe los fallos sin mensaje con la razon desconocida', () => {
    expect(buildAnimeMutationFailureFeedback(undefined).description).toBe(
      ANIME_MUTATION_FAILURE_UNKNOWN_REASON,
    );
  });
});
