import { collectConfirmedAnimeTokens } from '../../../src/features/sync/applied-operation-token.helpers';
import type { ReconcileAppliedOperation } from '../../../src/features/sync/reconcile.schema';

/** Builds a fixture `ReconcileAppliedOperation` entry, confirmed by default. */
function makeAppliedOperation(
  overrides: Partial<ReconcileAppliedOperation> = {},
): ReconcileAppliedOperation {
  return {
    anime_id: 'anime-1',
    operation: 'update',
    applied: true,
    ...overrides,
  };
}

describe('collectConfirmedAnimeTokens', () => {
  it('produces exactly one token for a modified_at of 0 and no entry for an absent key, in the same batch', () => {
    const tokens = collectConfirmedAnimeTokens([
      makeAppliedOperation({ anime_id: 'anime-zero', modified_at: 0 }),
      makeAppliedOperation({ anime_id: 'anime-absent' }),
    ]);

    expect(tokens).toEqual([{ animeId: 'anime-zero', bridgeModifiedAt: 0 }]);
  });

  it('contributes no token for an applied:false entry', () => {
    const tokens = collectConfirmedAnimeTokens([
      makeAppliedOperation({ anime_id: 'anime-1', applied: false, modified_at: 1788540735366 }),
    ]);

    expect(tokens).toEqual([]);
  });

  it('lets the last entry win when the same anime_id appears more than once', () => {
    const tokens = collectConfirmedAnimeTokens([
      makeAppliedOperation({ anime_id: 'anime-1', modified_at: 100 }),
      makeAppliedOperation({ anime_id: 'anime-1', modified_at: 200 }),
    ]);

    expect(tokens).toEqual([{ animeId: 'anime-1', bridgeModifiedAt: 200 }]);
  });

  it('returns an empty array for an empty batch', () => {
    expect(collectConfirmedAnimeTokens([])).toEqual([]);
  });

  it('produces a nonzero token as-is', () => {
    const tokens = collectConfirmedAnimeTokens([
      makeAppliedOperation({ anime_id: 'anime-1', modified_at: 1788540735366 }),
    ]);

    expect(tokens).toEqual([{ animeId: 'anime-1', bridgeModifiedAt: 1788540735366 }]);
  });
});
