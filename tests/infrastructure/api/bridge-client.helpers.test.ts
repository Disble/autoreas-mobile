import { extractSeasonMode } from '../../../src/infrastructure/api/bridge-client/bridge-url.helpers';

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
