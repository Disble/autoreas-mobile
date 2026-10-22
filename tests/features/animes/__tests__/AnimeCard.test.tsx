import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Card } from 'heroui-native';
import {
  openDeviceFolder,
  openPageUrl,
} from '../../../../src/features/anime-folders/anime-folders-io.helpers';
import { AnimeCard } from '../../../../src/features/animes/ui/AnimeCard/AnimeCard';
import {
  buildAnimeCardAnime,
  buildAnimeCardProps,
  classesOf,
  findAncestor,
  type RenderedNode,
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
    const { queryByLabelText } = render(<AnimeCard {...buildAnimeCardProps()} />);

    expect(queryByLabelText('Abrir la calificación de la nota')).toBeNull();
  });

  it('reads the confirmed note on the meta line only, with no bridge description beside it', () => {
    const { getAllByText, getByLabelText, queryByText } = render(
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
    expect(getByLabelText('Abrir la calificación de la nota')).toBeTruthy();
  });

  it('shows the newest local choice as the note, with no sync wording on the card', () => {
    const onOpenSeasonRatingSheet = jest.fn();
    const { getAllByText, getByLabelText, queryByText } = render(
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

    expect(getAllByText(/Nota 6\/6/)).toHaveLength(1);
    expect(queryByText(/Pendiente/)).toBeNull();
    expect(queryByText('Esperando confirmación del bridge')).toBeNull();

    fireEvent.press(getByLabelText('Abrir la calificación de la nota'));

    expect(onOpenSeasonRatingSheet).toHaveBeenCalledWith('anime-1');
  });

  it('shows the season CTA for an ungraded candidate without bridge confirmation', () => {
    const { getAllByText, getByLabelText, queryByText } = render(
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
    expect(getByLabelText('Abrir la calificación de la nota')).toBeTruthy();
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

  it('draws the title at 16 pt with regular weight in the foreground role', () => {
    const { getByText } = render(<AnimeCard {...buildAnimeCardProps()} />);

    const title = getByText('Dandadan');

    // `text-base` is 16 pt and `font-normal` is the 400 face AppText prepends.
    expect(title.props.className).toContain('text-base');
    expect(title.props.className).toContain('font-normal');
    expect(title.props.className).toContain('text-foreground');
    expect(title.props.className).not.toContain('text-sm');
    expect(title.props.className).not.toContain('font-semibold');
    expect(title.props.numberOfLines).toBe(2);
  });

  it('exposes the whole composed meta line as one accessible label on the toggle', () => {
    const { getByLabelText } = render(
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

    const toggle = getByLabelText('6 vistos · En pausa · Nota 4/6');

    expect(toggle.props.accessibilityHint).toBe('Alternar episodios restantes');
  });

  it('announces no toggle hint when there are no remaining episodes to show', () => {
    const { getByLabelText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: { ...buildAnimeCardAnime(), estado: 3, nrocapvisto: 6, totalcap: null },
        })}
      />,
    );

    expect(getByLabelText('6 vistos · En pausa').props.accessibilityHint).toBeUndefined();
  });

  it('leaves every meta span free to wrap instead of capping its lines', () => {
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

    expect(getByText('6 vistos').props.numberOfLines).toBeUndefined();
    expect(getByText(/• Finalizado/).props.numberOfLines).toBeUndefined();
    expect(getByText(/• Nota 4\/6/).props.numberOfLines).toBeUndefined();
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

    expect(getByText('1 visto • Viendo • Nota 3/6')).toBeTruthy();
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

    expect(getByText('6 vistos • En pausa • Nota 4/6')).toBeTruthy();
  });

  it('stops the meta line at the state when the anime has no season candidacy', () => {
    const { getByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: { ...buildAnimeCardAnime(), estado: 0, nrocapvisto: 3, seasonProjection: null },
        })}
      />,
    );

    expect(getByText('3 vistos • Viendo')).toBeTruthy();
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

    expect(getByText('1 visto • Viendo • Sin nota')).toBeTruthy();
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

  it('reaches a 44 pt touch area on the meta toggle through hit slop, not a taller box', () => {
    const { getByLabelText, getByText } = render(<AnimeCard {...buildAnimeCardProps()} />);

    const toggle = getByLabelText('4 vistos · Viendo');
    const line = getByText('4 vistos • Viendo');
    const { top, bottom } = toggle.props.hitSlop as { top: number; bottom: number };

    // The drawn line is 18 pt tall, so 44 pt needs 26 pt of slop split across the two edges.
    expect(line.props.className).toContain('leading-[18px]');
    expect(top + bottom).toBe(26);
    expect(toggle.props.className).not.toContain('min-h-11');
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

  it('gives the note star and Reanudar a 48 pt touch area', () => {
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

    expect(getByLabelText('Abrir la calificación de la nota').props.hitSlop).toBe(4);
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

  describe('layout', () => {
    it('grows to the grid row height so paired cards end on the same line', () => {
      const { UNSAFE_getByType } = render(<AnimeCard {...buildAnimeCardProps()} />);

      expect(classesOf(UNSAFE_getByType(Card))).toContain('grow');
      expect(classesOf(UNSAFE_getByType(Card.Body))).toContain('grow');
    });

    it('keeps the title group at the top and the actions row at the bottom', () => {
      const { getByText, getByLabelText } = render(<AnimeCard {...buildAnimeCardProps()} />);
      const titleColumn = findAncestor(getByText('Dandadan'), 'justify-between');
      const actionsColumn = findAncestor(getByLabelText('Sumar un capítulo visto'), 'justify-between');

      // The spare height of the shorter card in a row lands between its two groups, never under
      // the buttons, so the actions of both cards in a row line up.
      expect(titleColumn).not.toBeNull();
      expect(titleColumn).toBe(actionsColumn);
      expect(titleColumn?.props.className).toContain('flex-1');
    });

    it('lets the text column set the cover height instead of forcing a minimum', () => {
      const { UNSAFE_root } = render(<AnimeCard {...buildAnimeCardProps()} />);
      const [cover] = UNSAFE_root.findAll(
        (node: RenderedNode) =>
          typeof node.type === 'string' && classesOf(node).includes('w-24'),
      );

      // A minimum taller than a one-line card would leave an empty strip under the actions row.
      expect(cover.props.className).toContain('self-stretch');
      expect(cover.props.className).not.toMatch(/min-h-/);
    });
  });
});
