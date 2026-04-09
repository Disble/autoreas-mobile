import { renderHook } from '@testing-library/react-native';
import { useAnimeEmptyState } from '../../../../src/features/animes/ui/AnimeEmptyState/use-anime-empty-state';

describe('useAnimeEmptyState', () => {
  it('devuelve copy específico para pseudo-días de estrenos', () => {
    const { result } = renderHook(() =>
      useAnimeEmptyState({
        filter: 'Ver hoy',
      })
    );

    expect(result.current.message).toBe('No hay estrenos para ver hoy.');
    expect(result.current.hint).toBe('Probá con otro día o refrescá la sincronización manual.');
  });

  it('devuelve copy específico para días de la semana', () => {
    const { result } = renderHook(() =>
      useAnimeEmptyState({
        filter: 'Jueves',
      })
    );

    expect(result.current.message).toBe('No hay animes para Jueves.');
    expect(result.current.hint).toBe('Cuando Bridge sincronice animes para este día van a aparecer acá.');
  });
});
