import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  openDeviceFolder,
  openPageUrl,
} from '../../../../src/features/anime-folders/anime-folders-io.helpers';
import { LOCAL_ACTIVE_SEASON_ID } from '../../../../src/features/animes/anime-season.constants';
import { AnimeCard } from '../../../../src/features/animes/ui/AnimeCard/AnimeCard';
import { FOLDER_OPENING_FEEDBACK_MS } from '../../../../src/features/animes/ui/AnimeCard/anime-card.constants';
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

  it('shows confirmed bridge rating for active candidate', () => {
    const { getByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: {
            ...buildAnimeCardAnime(),
            seasonProjection: {
              seasonId: 'season-2026-q3',
              bridgeRating: 4,
              bridgeRatingSource: 'bridge',
              localIntent: null,
            },
          },
        })}
      />,
    );

    expect(getByText('Temporada 4/6')).toBeTruthy();
    expect(getByText('Confirmado por bridge')).toBeTruthy();
    expect(getByText('Temporada')).toBeTruthy();
  });

  it('shows pending local truth without claiming bridge confirmation', () => {
    const onOpenSeasonRatingSheet = jest.fn();
    const { getByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          onOpenSeasonRatingSheet,
          anime: {
            ...buildAnimeCardAnime(),
            seasonProjection: {
              seasonId: 'season-2026-q3',
              bridgeRating: 2,
              bridgeRatingSource: 'bridge',
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

    expect(getByText('Pendiente 6/6')).toBeTruthy();
    expect(getByText('Esperando confirmación del bridge')).toBeTruthy();

    fireEvent.press(getByText('Temporada'));

    expect(onOpenSeasonRatingSheet).toHaveBeenCalledWith('anime-1');
  });

  it('shows the season CTA for local active fallback without bridge confirmation', () => {
    const { getByText } = render(
      <AnimeCard
        {...buildAnimeCardProps({
          anime: {
            ...buildAnimeCardAnime(),
            seasonProjection: {
              seasonId: LOCAL_ACTIVE_SEASON_ID,
              bridgeRating: null,
              bridgeRatingSource: null,
              localIntent: null,
            },
          },
        })}
      />,
    );

    expect(getByText('Sin nota de temporada')).toBeTruthy();
    expect(getByText('Disponible para calificar')).toBeTruthy();
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

  it('shows that the folder is opening until My Files is up, ignoring repeated taps', () => {
    jest.mocked(openDeviceFolder).mockClear();
    jest.useFakeTimers();
    try {
      const { getByLabelText, queryByLabelText } = render(
        <AnimeCard
          {...buildAnimeCardProps({ folderPath: '/storage/0123-4567/Videos/Anime/Dandadan' })}
        />,
      );

      fireEvent.press(getByLabelText('Abrir carpeta del anime'));
      fireEvent.press(getByLabelText('Abriendo carpeta'));

      expect(openDeviceFolder).toHaveBeenCalledTimes(1);

      act(() => {
        jest.advanceTimersByTime(FOLDER_OPENING_FEEDBACK_MS);
      });

      expect(queryByLabelText('Abriendo carpeta')).toBeNull();
      fireEvent.press(getByLabelText('Abrir carpeta del anime'));
      expect(openDeviceFolder).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
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
});
