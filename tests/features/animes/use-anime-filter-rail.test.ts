import { act, renderHook } from '@testing-library/react-native';
import { ANIME_DAY_FILTER_OPTIONS } from '../../../src/features/animes/anime.constants';
import { useAnimeFilterRail } from '../../../src/features/animes/ui/AnimeFilterRail/use-anime-filter-rail';
import type { AnimeFilterRailProps } from '../../../src/features/animes/ui/AnimeFilterRail/anime-filter-rail.types';

function buildProps(overrides?: Partial<AnimeFilterRailProps>): AnimeFilterRailProps {
  return {
    options: ANIME_DAY_FILTER_OPTIONS,
    counts: { Jueves: 4, Viernes: 1 },
    selected: 'Jueves',
    today: 'Jueves',
    orientation: 'horizontal',
    onSelect: jest.fn(),
    ...overrides,
  };
}

describe('useAnimeFilterRail', () => {
  it('returns rail items with counts, today and selected flags', () => {
    const { result } = renderHook(() => useAnimeFilterRail(buildProps()));

    const jueves = result.current.items.find((item) => item.value === 'Jueves');
    expect(jueves).toMatchObject({ count: 4, isToday: true, isSelected: true });
  });

  it('exposes the chosen orientation to the view', () => {
    const { result } = renderHook(() =>
      useAnimeFilterRail(buildProps({ orientation: 'vertical' })),
    );

    expect(result.current.orientation).toBe('vertical');
  });

  it('invokes onSelect with the filter value when handleSelect runs', () => {
    const onSelect = jest.fn();
    const { result } = renderHook(() =>
      useAnimeFilterRail(buildProps({ onSelect })),
    );

    act(() => {
      result.current.handleSelect('Viernes');
    });

    expect(onSelect).toHaveBeenCalledWith('Viernes');
  });
});
