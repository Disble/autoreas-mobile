import { AnimeListSchema } from '../../../src/features/sync/initial-sync.schema';

/** Builds a fixture English bridge wire anime record, including the required OCC token. */
function makeWireAnime(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'anime-1',
    name: 'One Piece',
    status: 0,
    episodesWatched: 12,
    totalEpisodes: 24,
    active: 1,
    firstCycle: 0,
    genres: ['accion'],
    days: [{ day: 'Monday', order: 1 }],
    kind: 3,
    lastWatchedAt: null,
    premieredAt: null,
    createdAt: null,
    deletedAt: null,
    cover: null,
    sourceUrl: null,
    folder: null,
    studios: null,
    origin: null,
    durationMinutes: null,
    modified_at: 0,
    ...overrides,
  };
}

describe('AnimeListSchema', () => {
  it('transforms wire records into IngestedAnime[], pairing the domain shape with the token', () => {
    const parsed = AnimeListSchema.parse([
      makeWireAnime({ id: 'anime-1', modified_at: 1788540735366 }),
      makeWireAnime({ id: 'anime-2', modified_at: 0 }),
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      anime: expect.objectContaining({ _id: 'anime-1' }),
      bridgeModifiedAt: 1788540735366,
    });
    expect(parsed[1]).toEqual({
      anime: expect.objectContaining({ _id: 'anime-2' }),
      bridgeModifiedAt: 0,
    });
  });

  it('rejects a wire record missing modified_at', () => {
    const withoutToken = makeWireAnime() as Record<string, unknown>;
    delete withoutToken.modified_at;

    expect(() => AnimeListSchema.parse([withoutToken])).toThrow();
  });
});
