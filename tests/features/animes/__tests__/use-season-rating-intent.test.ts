import { renderHook } from '@testing-library/react-native';
import { enqueueSeasonRatingIntent } from '../../../../src/features/sync/season-rating-intent.helpers';
import { useSeasonRatingIntent } from '../../../../src/features/animes/use-season-rating-intent';
import { createMockRawDb } from './use-season-rating-intent.helpers';

jest.mock('../../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getExpoSQLiteUnavailableError: () => new Error('sqlite unavailable'),
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock('../../../../src/features/sync/season-rating-intent.helpers', () => ({
  enqueueSeasonRatingIntent: jest.fn(),
}));

describe('useSeasonRatingIntent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { useOptionalSQLiteContext } = jest.requireMock(
      '../../../../src/infrastructure/db/native-runtime/native-runtime.helpers',
    );
    useOptionalSQLiteContext.mockReturnValue(createMockRawDb());
  });

  it('queues the rating for the season the rated anime is a candidate of', async () => {
    (enqueueSeasonRatingIntent as jest.Mock).mockResolvedValue(undefined);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_752_400_000_000);
    const { result } = renderHook(() => useSeasonRatingIntent());

    await result.current.submitSeasonRatingIntent({ animeId: 'anime-1', seasonId: 'season-2026-q3' }, 6);
    await result.current.submitSeasonRatingIntent({ animeId: 'anime-2', seasonId: 'season-2026-q4' }, 4);

    expect((enqueueSeasonRatingIntent as jest.Mock).mock.calls).toEqual([
      [createMockRawDb(), { seasonId: 'season-2026-q3', animeId: 'anime-1', nota: 6, ratedAt: 1_752_400_000_000 }],
      [createMockRawDb(), { seasonId: 'season-2026-q4', animeId: 'anime-2', nota: 4, ratedAt: 1_752_400_000_000 }],
    ]);

    nowSpy.mockRestore();
  });

  it('rejects without queueing anything when the database is unavailable', async () => {
    const { useOptionalSQLiteContext } = jest.requireMock(
      '../../../../src/infrastructure/db/native-runtime/native-runtime.helpers',
    );
    useOptionalSQLiteContext.mockReturnValue(null);
    const { result } = renderHook(() => useSeasonRatingIntent());

    await expect(
      result.current.submitSeasonRatingIntent({ animeId: 'anime-1', seasonId: 'season-2026-q3' }, 6),
    ).rejects.toThrow('sqlite unavailable');
    expect(enqueueSeasonRatingIntent).not.toHaveBeenCalled();
  });
});
