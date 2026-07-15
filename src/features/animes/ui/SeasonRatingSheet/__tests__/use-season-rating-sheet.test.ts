import { act, renderHook } from '@testing-library/react-native';
import { useSeasonRatingSheet } from '../use-season-rating-sheet';

describe('useSeasonRatingSheet', () => {
  it('derives pending truth ahead of bridge truth', () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    const { result } = renderHook(() =>
      useSeasonRatingSheet({
        isOpen: true,
        animeTitle: 'Dan Da Dan',
        bridgeRating: 4,
        pendingRating: 6,
        pendingStatus: 'pending',
        pendingFailureKind: null,
        onClose,
        onSubmit,
      }),
    );

    expect(result.current.selectedRating).toBe(6);
    expect(result.current.bridgeSummary.valueLabel).toBe('4/6');
    expect(result.current.status?.kind).toBe('pending');
  });

  it('submits the selected rating through the public callback', () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    const { result } = renderHook(() =>
      useSeasonRatingSheet({
        isOpen: true,
        animeTitle: 'Sakamoto Days',
        bridgeRating: null,
        pendingRating: null,
        pendingStatus: null,
        pendingFailureKind: null,
        onClose,
        onSubmit,
      }),
    );

    act(() => {
      result.current.handleSelectRating(5);
    });

    act(() => {
      result.current.handleSubmit();
    });

    expect(onSubmit).toHaveBeenCalledWith(5);
  });
});
