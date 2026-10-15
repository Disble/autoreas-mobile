import { normalizeBridgeChange } from '../../../src/features/sync/bridge-change.helpers';
import { recordDiagnosticEvent } from '../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers';

jest.mock('../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers', () => ({
  recordDiagnosticEvent: jest.fn(),
}));

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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps known wire field names to local names and records nothing', () => {
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
    expect(recordDiagnosticEvent).not.toHaveBeenCalled();
  });

  it('drops unknown field names and records the change as rejected', () => {
    const change = normalizeBridgeChange({
      record_id: 'anime-1',
      change_type: 'update',
      changed_fields: ['fieldFromTheFuture'],
      snapshot: SNAPSHOT,
      timestamp: 1710000001000,
    } as never);

    expect(change.changedFields).toEqual([]);
    expect(recordDiagnosticEvent).toHaveBeenCalledWith({
      source: 'sync_cycle',
      event: 'remote_change_rejected',
      cause: null,
      at: expect.any(Number),
    });
  });
});
