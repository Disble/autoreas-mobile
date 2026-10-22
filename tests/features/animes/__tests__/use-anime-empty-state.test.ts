import { renderHook } from '@testing-library/react-native';
import { useAnimeEmptyState } from '../../../../src/features/animes/ui/AnimeEmptyState/use-anime-empty-state';

describe('useAnimeEmptyState', () => {
  it.each([
    ['Ver hoy', 'Hoy no hay estrenos para ver.', 'Día libre: nada en la lista de hoy.'],
    [
      'Sin ver',
      'No hay estrenos pendientes esta temporada.',
      'Ya viste todos o todavía no se agregaron estrenos.',
    ],
    [
      'Visto',
      'Todavía no viste ningún estreno esta temporada.',
      'Los estrenos que termines aparecerán aquí.',
    ],
  ] as const)('explains an empty %s as a stage of the season, not a day', (filter, message, hint) => {
    const { result } = renderHook(() => useAnimeEmptyState({ filter }));

    expect(result.current.message).toBe(message);
    expect(result.current.hint).toBe(hint);
  });

  it('devuelve copy específico para días de la semana', () => {
    const { result } = renderHook(() =>
      useAnimeEmptyState({
        filter: 'Jueves',
      })
    );

    expect(result.current.message).toBe('No hay animes para Jueves.');
    expect(result.current.hint).toBe('Cuando Bridge sincronice animes para este día, aparecerán aquí.');
  });
});
