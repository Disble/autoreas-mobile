import {
  parseStoredAnimeSeason,
  serializeAnimeSeason,
} from '../../../src/infrastructure/validation/anime-schema';

describe('serializeAnimeSeason', () => {
  it('writes the canonical key order seasonId, grade whatever the input order', () => {
    expect(serializeAnimeSeason({ grade: 3, seasonId: 'season-7' } as never)).toBe(
      '{"seasonId":"season-7","grade":3}',
    );
    expect(serializeAnimeSeason({ seasonId: 'season-7', grade: null })).toBe(
      '{"seasonId":"season-7","grade":null}',
    );
  });

  it('returns null for an anime that is not a candidate', () => {
    expect(serializeAnimeSeason(undefined)).toBeNull();
    expect(serializeAnimeSeason(null)).toBeNull();
  });
});

describe('parseStoredAnimeSeason', () => {
  it('reads the stored candidacy back', () => {
    expect(parseStoredAnimeSeason('{"seasonId":"season-7","grade":3}')).toEqual({
      seasonId: 'season-7',
      grade: 3,
    });
  });

  it('reads a NULL column, broken JSON or an out-of-contract value as not a candidate', () => {
    expect(parseStoredAnimeSeason(null)).toBeNull();
    expect(parseStoredAnimeSeason('{not json')).toBeNull();
    expect(parseStoredAnimeSeason('{"seasonId":"season-7","grade":0}')).toBeNull();
    expect(parseStoredAnimeSeason('{"grade":2}')).toBeNull();
  });
});
