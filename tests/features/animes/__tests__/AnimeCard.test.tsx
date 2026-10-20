import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import {
  openDeviceFolder,
  openPageUrl,
} from '../../../../src/features/anime-folders/anime-folders-io.helpers';
import { AnimeCard } from '../../../../src/features/animes/ui/AnimeCard/AnimeCard';
import {
  buildAnimeCardAnime,
  buildAnimeCardProps,
} from './anime-card-test.helpers';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../../../src/features/anime-folders/anime-folders-io.helpers', () => ({
  openDeviceFolder: jest.fn(),
  openPageUrl: jest.fn(),
}));

describe('AnimeCard', () => {
  it('marks the next episode when the bridge says it is long', () => {
    const { getByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: {
            ...buildAnimeCardAnime(),
            nrocapvisto: 6,
            episodes: [{ episode: 7, minutes: 45, long: true }],
          },
        })}
      />,
    );

    expect(getByText('Ep. 7 · 45 min')).toBeTruthy();
  });

  it('shows no long-episode mark when the next episode is not long', () => {
    const { queryByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: {
            ...buildAnimeCardAnime(),
            nrocapvisto: 6,
            episodes: [{ episode: 7, minutes: 24, long: false }],
          },
        })}
      />,
    );

    expect(queryByText(/^Ep\. 7/)).toBeNull();
  });

  it('shows no season CTA for non-candidates', () => {
    const { queryByText } = render(<AnimeCard {...buildAnimeCardProps()} />);

    expect(queryByText('Temporada')).toBeNull();
  });

  it('reads the confirmed note on the meta line only, with no bridge description beside it', () => {
    const { getAllByText, getByText, queryByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: {
            ...buildAnimeCardAnime(),
            seasonProjection: {
              seasonId: 'season-2026-q3',
              bridgeRating: 4,
              localIntent: null,
            },
          },
        })}
      />,
    );

    // The note appears exactly once, on the meta line; the season status row that repeated it is gone.
    expect(getAllByText(/Nota 4\/6/)).toHaveLength(1);
    expect(queryByText('Confirmado por bridge')).toBeNull();
    expect(getByText('Temporada')).toBeTruthy();
  });

  it('shows pending local truth without claiming bridge confirmation', () => {
    const onOpenSeasonRatingSheet = jest.fn();
    const { getAllByText, getByText, queryByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          onOpenSeasonRatingSheet,
          anime: {
            ...buildAnimeCardAnime(),
            seasonProjection: {
              seasonId: 'season-2026-q3',
              bridgeRating: 2,
              localIntent: {
                nota: 6,
                ratedAt: 1_752_500_000_000,
                createdAt: 1_752_500_100_000,
                status: 'pending',
                failureKind: null,
              },
            },
          },
        })}
      />,
    );

    expect(getAllByText(/Pendiente 6\/6/)).toHaveLength(1);
    expect(queryByText('Esperando confirmación del bridge')).toBeNull();

    fireEvent.press(getByText('Temporada'));

    expect(onOpenSeasonRatingSheet).toHaveBeenCalledWith('anime-1');
  });

  it('shows the season CTA for an ungraded candidate without bridge confirmation', () => {
    const { getAllByText, getByText, queryByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: {
            ...buildAnimeCardAnime(),
            seasonProjection: {
              seasonId: 'season-2026-q3',
              bridgeRating: null,
              localIntent: null,
            },
          },
        })}
      />,
    );

    expect(getAllByText(/Sin nota/)).toHaveLength(1);
    expect(queryByText('Disponible para calificar')).toBeNull();
    expect(getByText('Temporada')).toBeTruthy();
  });

  it('opens the anime page and its folder from the shortcuts', () => {
    const { getByLabelText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: { ...buildAnimeCardAnime(), pagina: 'https://jkanime.net/dandadan/' },
          folderPath: '/storage/0123-4567/Videos/Anime/Dandadan',
        })}
      />,
    );

    fireEvent.press(getByLabelText('Abrir página del anime'));
    fireEvent.press(getByLabelText('Abrir carpeta del anime'));

    expect(openPageUrl).toHaveBeenCalledWith('https://jkanime.net/dandadan/');
    expect(openDeviceFolder).toHaveBeenCalledWith('/storage/0123-4567/Videos/Anime/Dandadan');
  });

  it('shows no page shortcut without an http(s) page, and no folder shortcut without a folder', () => {
    const { queryByLabelText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: { ...buildAnimeCardAnime(), pagina: 'descargado' },
          folderPath: null,
        })}
      />,
    );

    expect(queryByLabelText('Abrir página del anime')).toBeNull();
    expect(queryByLabelText('Abrir carpeta del anime')).toBeNull();
  });

  it('keeps the shortcuts while the anime is paused, next to Reanudar', () => {
    const { getByLabelText, getByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: { ...buildAnimeCardAnime(), estado: 2, pagina: 'https://jkanime.net/dandadan/' },
          folderPath: '/storage/0123-4567/Videos/Anime/Dandadan',
        })}
      />,
    );

    expect(getByText('Reanudar')).toBeTruthy();
    expect(getByLabelText('Abrir página del anime')).toBeTruthy();
    expect(getByLabelText('Abrir carpeta del anime')).toBeTruthy();
  });

  it('renders one watched chapter, the state and the note as a single line', () => {
    const { getByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: {
            ...buildAnimeCardAnime(),
            estado: 0,
            nrocapvisto: 1,
            seasonProjection: {
              seasonId: 'season-2026-q3',
              bridgeRating: 3,
              localIntent: null,
            },
          },
        })}
      />,
    );

    expect(getByText('1 capítulo visto · Viendo · Nota 3/6')).toBeTruthy();
  });

  it('keeps the paused state on the same meta line as several watched chapters and the note', () => {
    const { getByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: {
            ...buildAnimeCardAnime(),
            estado: 3,
            nrocapvisto: 6,
            seasonProjection: {
              seasonId: 'season-2026-q3',
              bridgeRating: 4,
              localIntent: null,
            },
          },
        })}
      />,
    );

    expect(getByText('6 capítulos vistos · En pausa · Nota 4/6')).toBeTruthy();
  });

  it('stops the meta line at the state when the anime has no season candidacy', () => {
    const { getByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: { ...buildAnimeCardAnime(), estado: 0, nrocapvisto: 3, seasonProjection: null },
        })}
      />,
    );

    expect(getByText('3 capítulos vistos · Viendo')).toBeTruthy();
  });

  it('reads Sin nota on the meta line when the candidate has no rating yet', () => {
    const { getByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: {
            ...buildAnimeCardAnime(),
            estado: 0,
            nrocapvisto: 1,
            seasonProjection: {
              seasonId: 'season-2026-q3',
              bridgeRating: null,
              localIntent: null,
            },
          },
        })}
      />,
    );

    expect(getByText('1 capítulo visto · Viendo · Sin nota')).toBeTruthy();
  });

  it('leaves the meta line free to wrap instead of capping its lines', () => {
    const { getByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: {
            ...buildAnimeCardAnime(),
            estado: 1,
            nrocapvisto: 6,
            seasonProjection: {
              seasonId: 'season-2026-q3',
              bridgeRating: 4,
              localIntent: null,
            },
          },
        })}
      />,
    );

    expect(getByText('6 capítulos vistos · Finalizado · Nota 4/6').props.numberOfLines).toBeUndefined();
  });

  it('shows the state once, inside the meta line, with no coloured chip beside it', () => {
    const { getAllByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: {
            ...buildAnimeCardAnime(),
            estado: 3,
            nrocapvisto: 6,
            seasonProjection: {
              seasonId: 'season-2026-q3',
              bridgeRating: 4,
              localIntent: null,
            },
          },
        })}
      />,
    );

    expect(getAllByText(/En pausa/)).toHaveLength(1);
  });

  it('opens the state sheet from the ellipsis for a non-default state', () => {
    const onOpenStateSheet = jest.fn();
    const { getByLabelText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          onOpenStateSheet,
          anime: { ...buildAnimeCardAnime(), estado: 3 },
        })}
      />,
    );

    fireEvent.press(getByLabelText('Cambiar estado: En pausa'));

    expect(onOpenStateSheet).toHaveBeenCalledWith('anime-1', 3);
  });

  it('gives the ellipsis a 44 pt touch area without enlarging its icon', () => {
    const { getByLabelText } = render(
      <AnimeCard {...buildAnimeCardProps({ anime: { ...buildAnimeCardAnime(), estado: 3 } })} />,
    );

    const ellipsis = getByLabelText('Cambiar estado: En pausa');

    // 28 pt box (h-7/w-7) plus 8 pt of hit slop on every side reaches the 44 pt minimum.
    expect(ellipsis.props.hitSlop).toBe(8);
    expect(ellipsis.props.className).toContain('h-7');
    expect(ellipsis.props.className).toContain('w-7');
  });

  it('gives the meta toggle a 44 pt minimum touch area', () => {
    const { getByLabelText } = render(<AnimeCard {...buildAnimeCardProps()} />);

    const toggle = getByLabelText('Alternar episodios restantes');

    expect(toggle.props.className).toContain('min-h-11');
    expect(toggle.props.className).toContain('min-w-11');
  });

  it('gives the page and folder shortcuts a 48 pt touch area at their 40 pt visual size', () => {
    const { getByLabelText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: { ...buildAnimeCardAnime(), pagina: 'https://jkanime.net/dandadan/' },
          folderPath: '/storage/0123-4567/Videos/Anime/Dandadan',
        })}
      />,
    );

    // `size="sm"` draws a 40 pt box and `hitSlop={4}` adds 4 pt per side, so the target is 48 pt.
    expect(getByLabelText('Abrir página del anime').props.hitSlop).toBe(4);
    expect(getByLabelText('Abrir carpeta del anime').props.hitSlop).toBe(4);
  });

  it('gives the Temporada CTA and Reanudar a 48 pt touch area', () => {
    const { getByLabelText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: {
            ...buildAnimeCardAnime(),
            estado: 2,
            seasonProjection: {
              seasonId: 'season-2026-q3',
              bridgeRating: null,
              localIntent: null,
            },
          },
        })}
      />,
    );

    expect(getByLabelText('Abrir calificación de temporada').props.hitSlop).toBe(4);
    expect(getByLabelText('Reanudar anime').props.hitSlop).toBe(4);
  });

  it('labels the chapter buttons in Spanish and gives them a 48 pt touch area', () => {
    const onCapMinus = jest.fn();
    const onCapPlus = jest.fn();
    const { getByLabelText, queryByLabelText } = render(
      <AnimeCard {...buildAnimeCardProps({ onCapMinus, onCapPlus })} />,
    );

    const minus = getByLabelText('Restar un capítulo visto');
    const plus = getByLabelText('Sumar un capítulo visto');

    expect(minus.props.hitSlop).toBe(4);
    expect(plus.props.hitSlop).toBe(4);
    expect(queryByLabelText('Decrease chapter')).toBeNull();
    expect(queryByLabelText('Increase chapter')).toBeNull();

    fireEvent.press(minus);
    fireEvent.press(plus);

    expect(onCapMinus).toHaveBeenCalledTimes(1);
    expect(onCapPlus).toHaveBeenCalledTimes(1);
  });
});
