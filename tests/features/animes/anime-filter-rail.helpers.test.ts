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

  it('flags weekdays vs pseudo-days so the rail can render a section break', () => {
    const items = buildAnimeFilterRailItems({
      options: ANIME_DAY_FILTER_OPTIONS,
      counts: {},
      today: 'Lunes',
      selected: 'Lunes',
    });

    const lunes = items.find((item) => item.value === 'Lunes');
    const sinVer = items.find((item) => item.value === 'Sin ver');
    const verHoy = items.find((item) => item.value === 'Ver hoy');
    const visto = items.find((item) => item.value === 'Visto');

    expect(lunes?.isPseudoDay).toBe(false);
    expect(sinVer?.isPseudoDay).toBe(true);
    expect(verHoy?.isPseudoDay).toBe(true);
    expect(visto?.isPseudoDay).toBe(true);
  });

  it('marks the first pseudo-day item so the view can insert a single divider', () => {
    const items = buildAnimeFilterRailItems({
      options: ANIME_DAY_FILTER_OPTIONS,
      counts: {},
      today: 'Lunes',
      selected: 'Lunes',
    });

    const pseudoDayItems = items.filter((item) => item.isPseudoDay);
    const firstPseudoDay = pseudoDayItems[0];
    const otherPseudoDays = pseudoDayItems.slice(1);

    expect(firstPseudoDay?.isFirstPseudoDay).toBe(true);
    otherPseudoDays.forEach((item) => {
      expect(item.isFirstPseudoDay).toBe(false);
    });
  });

  it('never marks weekdays as first pseudo-day', () => {
    const items = buildAnimeFilterRailItems({
      options: ANIME_DAY_FILTER_OPTIONS,
      counts: {},
      today: 'Lunes',
      selected: 'Lunes',
    });

    const weekdayItems = items.filter((item) => !item.isPseudoDay);
    weekdayItems.forEach((item) => {
      expect(item.isFirstPseudoDay).toBe(false);
    });
  });
});
