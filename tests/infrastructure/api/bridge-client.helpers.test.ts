import {
  buildPostActiveSeasonRatingBody,
  extractActiveSeasonSnapshot,
  extractSeasonMode,
} from '../../../src/infrastructure/api/bridge-client/bridge-url.helpers';

describe('extractActiveSeasonSnapshot', () => {
  it('maps the bridge `grade`/`grade_source` wire keys onto candidate snapshots', () => {
    const snapshot = extractActiveSeasonSnapshot({
      season_id: '2026-q3',
      candidates: [
        { anime_id: 'a1', grade: 5, grade_source: 'bridge' },
        { anime_id: 'a2', grade: null },
      ],
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.seasonId).toBe('2026-q3');
    expect(snapshot?.candidatesByAnimeId.a1).toEqual({
      animeId: 'a1',
      bridgeRating: 5,
      bridgeRatingSource: 'bridge',
    });
    expect(snapshot?.candidatesByAnimeId.a2).toEqual({
      animeId: 'a2',
      bridgeRating: null,
      bridgeRatingSource: null,
    });
  });

  it('drops candidates missing a usable anime_id', () => {
    const snapshot = extractActiveSeasonSnapshot({
      season_id: '2026-q3',
      candidates: [{ grade: 4, grade_source: 'bridge' }, { anime_id: '' }],
    });

    expect(snapshot?.candidates).toHaveLength(0);
  });
});

describe('buildPostActiveSeasonRatingBody', () => {
  it('serializes the rating onto the bridge `grade` wire key without rewriting ratedAt', () => {
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

describe('extractSeasonMode', () => {
  it('returns true when the status body reports season_mode true', () => {
    expect(extractSeasonMode({ status: 'ok', season_mode: true })).toBe(true);
  });

  it('returns false when season_mode is explicitly false', () => {
    expect(extractSeasonMode({ status: 'ok', season_mode: false })).toBe(false);
  });

  it('defaults to false when season_mode is absent (legacy/partial status)', () => {
    expect(extractSeasonMode({ status: 'ok' })).toBe(false);
  });

  it.each([null, undefined, 'true', 1, [], { season_mode: 'true' }, { season_mode: 1 }])(
    'defaults to false for malformed input %p',
    (input) => {
      expect(extractSeasonMode(input)).toBe(false);
    },
  );
});
