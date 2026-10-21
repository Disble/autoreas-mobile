import { act, renderHook } from '@testing-library/react-native';
import { ANIME_DAY_FILTER_OPTIONS } from '../../../src/features/animes/anime.constants';
import { useAnimeFilterRail } from '../../../src/features/animes/ui/AnimeFilterRail/use-anime-filter-rail';
import type { AnimeFilterRailProps } from '../../../src/features/animes/ui/AnimeFilterRail/anime-filter-rail.types';

/** Builds rail props with Jueves selected and today, overriding any field. */
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

  it('scrolls the active chip to the center, without animation first and animated on change', () => {
    const scrollTo = jest.fn();
    const { result, rerender } = renderHook(
      (props: AnimeFilterRailProps) => useAnimeFilterRail(props),
      { initialProps: buildProps({ selected: 'Jueves' }) },
    );
    (result.current.scrollRef as { current: unknown }).current = { scrollTo };

    act(() => {
      result.current.handleViewportLayout(layoutEvent(400));
      result.current.handleChipLayout('Viernes', { x: 600, width: 100 });
      result.current.handleChipLayout('Jueves', { x: 500, width: 100 });
    });

    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });

    rerender(buildProps({ selected: 'Viernes' }));

    expect(scrollTo).toHaveBeenLastCalledWith({ x: 450, animated: true });
  });
});

/** Builds the layout event a view of the given width reports. */
function layoutEvent(width: number) {
  return { nativeEvent: { layout: { x: 0, y: 0, width, height: 40 } } } as Parameters<
    ReturnType<typeof useAnimeFilterRail>['handleViewportLayout']
  >[0];
}
