import {
  buildPostActiveSeasonRatingBody,
  extractActiveSeasonSnapshot,
} from '../bridge-client/bridge-url.helpers';

describe('bridge client season helpers', () => {
  it('maps a bridge snapshot into a candidate-only projection', () => {
    const snapshot = extractActiveSeasonSnapshot({
      season_id: 'season-2026-q3',
      candidates: [
        {
          anime_id: 'anime-1',
          nota_estreno: 6,
          nota_source: 'bridge',
        },
        {
          anime_id: '',
          nota_estreno: 4,
          nota_source: 'bridge',
        },
        {
          nota_estreno: 3,
          nota_source: 'bridge',
        },
      ],
      animes: [
        {
          anime_id: 'anime-local-only',
        },
      ],
    });

    expect(snapshot).toEqual({
      seasonId: 'season-2026-q3',
      candidates: [
        {
          animeId: 'anime-1',
          bridgeRating: 6,
          bridgeRatingSource: 'bridge',
        },
      ],
      candidatesByAnimeId: {
        'anime-1': {
          animeId: 'anime-1',
          bridgeRating: 6,
          bridgeRatingSource: 'bridge',
        },
      },
    });
  });

  it('returns null when the bridge-owned season shape is missing', () => {
    expect(
      extractActiveSeasonSnapshot({
        candidates: [],
      }),
    ).toBeNull();
  });

  it('serializes a season rating request without rewriting ratedAt', () => {
    expect(
      buildPostActiveSeasonRatingBody({
        animeId: 'anime-9',
        nota: 4,
        ratedAt: 1_752_300_000_000,
      }),
    ).toEqual({
      anime_id: 'anime-9',
      grade: 4,
      rated_at: 1_752_300_000_000,
    });
  });
});
