import {
  parseStoredEpisodeLengths,
  serializeEpisodeLengths,
} from '../../../src/infrastructure/validation/anime-schema';

describe('serializeEpisodeLengths', () => {
  it('writes the canonical key order episode, minutes, long whatever the input order', () => {
    const serialized = serializeEpisodeLengths([
      { long: true, minutes: 46, episode: 2 } as never,
    ]);

    expect(serialized).toBe('[{"episode":2,"minutes":46,"long":true}]');
  });

  it('returns null when no durations are known (absent, null or empty)', () => {
    expect(serializeEpisodeLengths(undefined)).toBeNull();
    expect(serializeEpisodeLengths(null)).toBeNull();
    expect(serializeEpisodeLengths([])).toBeNull();
  });
});

describe('parseStoredEpisodeLengths', () => {
  it('reads the stored JSON text back into entries', () => {
    expect(parseStoredEpisodeLengths('[{"episode":1,"minutes":24,"long":false}]')).toEqual([
      { episode: 1, minutes: 24, long: false },
    ]);
  });

  it('returns null for a NULL column', () => {
    expect(parseStoredEpisodeLengths(null)).toBeNull();
  });

  it('returns null for text that is not JSON instead of throwing', () => {
    expect(parseStoredEpisodeLengths('not json')).toBeNull();
  });

  it('returns null when an entry breaks the contract (episode below 1)', () => {
    expect(parseStoredEpisodeLengths('[{"episode":0,"minutes":24,"long":false}]')).toBeNull();
  });
});
