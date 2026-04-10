import { ANIME_DAY_FILTER_OPTIONS } from '../../../src/features/animes/anime.constants';
import { buildAnimeFilterRailItems } from '../../../src/features/animes/ui/AnimeFilterRail/anime-filter-rail.helpers';

describe('buildAnimeFilterRailItems', () => {
  it('maps options into rail items with counts and today flag', () => {
    const items = buildAnimeFilterRailItems({
      options: ANIME_DAY_FILTER_OPTIONS,
      counts: { Jueves: 3, Viernes: 2, Visto: 5 },
      today: 'Jueves',
      selected: 'Viernes',
    });

    const jueves = items.find((item) => item.value === 'Jueves');
    const viernes = items.find((item) => item.value === 'Viernes');
    const visto = items.find((item) => item.value === 'Visto');
    const lunes = items.find((item) => item.value === 'Lunes');

    expect(jueves).toMatchObject({
      value: 'Jueves',
      label: 'Jueves',
      count: 3,
      isToday: true,
      isSelected: false,
    });
    expect(viernes).toMatchObject({
      value: 'Viernes',
      count: 2,
      isToday: false,
      isSelected: true,
    });
    expect(visto).toMatchObject({ count: 5, isToday: false });
    expect(lunes).toMatchObject({ count: 0, isToday: false });
  });

  it('returns zero count when options are missing from the counts map', () => {
    const items = buildAnimeFilterRailItems({
      options: ANIME_DAY_FILTER_OPTIONS,
      counts: {},
      today: 'Lunes',
      selected: 'Lunes',
    });

    items.forEach((item) => {
      expect(item.count).toBe(0);
    });
  });

  it('preserves the original option order', () => {
    const items = buildAnimeFilterRailItems({
      options: ANIME_DAY_FILTER_OPTIONS,
      counts: {},
      today: 'Lunes',
      selected: 'Lunes',
    });

    expect(items.map((item) => item.value)).toEqual(
      ANIME_DAY_FILTER_OPTIONS.map((option) => option.value),
    );
  });
});
