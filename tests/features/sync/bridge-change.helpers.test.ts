import { normalizeBridgeChange } from '../../../src/features/sync/bridge-change.helpers';

/** Minimal valid wire snapshot for `anime-1`. */
const SNAPSHOT = {
  id: 'anime-1',
  name: 'Naruto',
  status: 2,
  episodesWatched: 3,
  active: 1,
  firstCycle: 0,
  days: [],
  genres: [],
  modified_at: 0,
};

describe('normalizeBridgeChange', () => {
  it('maps known wire field names to local names', () => {
    const change = normalizeBridgeChange({
      record_id: 'anime-1',
      change_type: 'update',
      changed_fields: ['status', 'episodesWatched'],
      snapshot: SNAPSHOT,
      timestamp: 1710000001000,
    } as never);

    expect(change).toEqual(
      expect.objectContaining({
        recordId: 'anime-1',
        changeType: 'update',
        changedFields: ['estado', 'nrocapvisto'],
        timestamp: 1710000001000,
      }),
    );
  });

  it('drops unknown field names, never guessing at them', () => {
    const change = normalizeBridgeChange({
      record_id: 'anime-1',
      change_type: 'update',
      changed_fields: ['fieldFromTheFuture'],
      snapshot: SNAPSHOT,
      timestamp: 1710000001000,
    } as never);

    expect(change.changedFields).toEqual([]);
  });
});
