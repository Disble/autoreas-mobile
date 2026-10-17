import {
  buildSeasonRatingRequest,
  classifySeasonRatingAnswer,
  mapSeasonRatingIntents,
  parseSeasonRatingPayload,
} from '../../../src/features/sync/season-rating-event.helpers';
import { buildOperationLogEntity } from '../../support/sync-fixtures.helpers';

describe('season rating events (L28)', () => {
  it('reads anything that is not a JSON object as an empty payload', () => {
    expect(parseSeasonRatingPayload('{"seasonId":"s","grade":4,"ratedAt":9}')).toEqual({ seasonId: 's', grade: 4, ratedAt: 9 });
    expect(parseSeasonRatingPayload('[1]')).toEqual({});
    expect(parseSeasonRatingPayload('null')).toEqual({});
    expect(parseSeasonRatingPayload('not json')).toEqual({});
    expect(parseSeasonRatingPayload(null)).toEqual({});
  });

  it('builds the wire request from the row, leaving out what the payload lacks', () => {
    expect(buildSeasonRatingRequest({ animeId: 'anime-1', payload: '{"grade":4,"ratedAt":9}' })).toEqual({
      animeId: 'anime-1',
      nota: 4,
      ratedAt: 9,
    });
    expect(JSON.stringify(buildSeasonRatingRequest({ animeId: 'anime-1', payload: '{}' }))).toBe('{"animeId":"anime-1"}');
  });

  it.each([
    [204, { kind: 'delivered' }],
    [401, { kind: 'given_up', reason: 'auth_repair' }],
    [404, { kind: 'given_up', reason: 'not_found' }],
    [409, { kind: 'given_up', reason: 'conflict' }],
    [400, { kind: 'given_up', reason: 'rejected' }],
    [499, { kind: 'given_up', reason: 'rejected' }],
    [200, { kind: 'pending' }],
    [399, { kind: 'pending' }],
    [500, { kind: 'pending' }],
    [null, { kind: 'pending' }],
  ] as const)('classifies a %s answer once, the same as the Kotlin sender', (status, fate) => {
    expect(classifySeasonRatingAnswer(status)).toEqual(fate);
  });

  it('maps waiting, in-flight and given-up ratings to intents, and nothing else', () => {
    const rating = (id: number, status: string, unresolvedReason: string | null = null) =>
      buildOperationLogEntity({
        id,
        operation: 'season_rating',
        payload: JSON.stringify({ seasonId: 'season-1', grade: id, ratedAt: 100 + id }),
        status,
        createdAt: 1_000 + id,
        unresolvedReason,
      });

    expect(
      mapSeasonRatingIntents([
        rating(1, 'pending'),
        rating(2, 'processing'),
        rating(3, 'dead_letter', 'conflict'),
        rating(4, 'synced'),
        buildOperationLogEntity({ id: 5, status: 'pending' }),
      ]),
    ).toEqual([
      { id: 1, animeId: 'anime-1', seasonId: 'season-1', nota: 1, ratedAt: 101, createdAt: 1_001, status: 'pending', failureKind: null },
      { id: 2, animeId: 'anime-1', seasonId: 'season-1', nota: 2, ratedAt: 102, createdAt: 1_002, status: 'syncing', failureKind: null },
      { id: 3, animeId: 'anime-1', seasonId: 'season-1', nota: 3, ratedAt: 103, createdAt: 1_003, status: 'failed', failureKind: 'conflict' },
    ]);
  });
});
