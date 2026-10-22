import { act, renderHook } from '@testing-library/react-native';
import { useSeasonRatingSheet } from '../../../../src/features/animes/ui/SeasonRatingSheet/use-season-rating-sheet';
import type { SeasonRatingSheetProps } from '../../../../src/features/animes/ui/SeasonRatingSheet/season-rating-sheet.types';

/** Builds a complete prop set for the sheet hook so each test states only what it exercises. */
function buildProps(
  overrides: Partial<SeasonRatingSheetProps> = {},
): SeasonRatingSheetProps {
  return {
    isOpen: true,
    animeTitle: 'Test',
    bridgeRating: null,
    pendingRating: null,
    onClose: jest.fn(),
    onSubmit: jest.fn(),
    ...overrides,
  };
}

describe('useSeasonRatingSheet', () => {
  it('derives pending truth ahead of bridge truth', () => {
    const { result } = renderHook(() =>
      useSeasonRatingSheet(
        buildProps({
          animeTitle: 'Dan Da Dan',
          bridgeRating: 4,
          pendingRating: 6,
        }),
      ),
    );

    expect(result.current.selectedRating).toBe(6);
  });

  it('exposes no sync status in the view model', () => {
    const { result } = renderHook(() =>
      useSeasonRatingSheet(buildProps({ bridgeRating: 4, pendingRating: 6 })),
    );

    expect('status' in result.current).toBe(false);
  });

  it('submits the selected rating through the public callback', () => {
    const onSubmit = jest.fn();
    const { result } = renderHook(() =>
      useSeasonRatingSheet(buildProps({ animeTitle: 'Sakamoto Days', onSubmit })),
    );

    act(() => {
      result.current.handleSelectRating(5);
    });

    act(() => {
      result.current.handleSubmit();
    });

    expect(onSubmit).toHaveBeenCalledWith(5);
  });

  it('preserves user choice when props change', () => {
    const initialProps = buildProps({ bridgeRating: 3 });
    const { result, rerender } = renderHook(
      (p) => useSeasonRatingSheet(p as SeasonRatingSheetProps),
      { initialProps },
    );

    expect(result.current.selectedRating).toBe(3);

    act(() => {
      result.current.handleSelectRating(6);
    });

    expect(result.current.selectedRating).toBe(6);

    rerender({
      ...initialProps,
      bridgeRating: 1,
    });

    expect(result.current.selectedRating).toBe(6);
  });

  it('drops an unsaved choice when the sheet reopens for an anime without a note', () => {
    const initialProps = buildProps({ animeTitle: 'Anime A' });
    const { result, rerender } = renderHook(
      (p) => useSeasonRatingSheet(p as SeasonRatingSheetProps),
      { initialProps },
    );

    act(() => {
      result.current.handleSelectRating(4);
    });

    rerender({ ...initialProps, isOpen: false, animeTitle: '' });
    rerender({ ...initialProps, animeTitle: 'Anime B' });

    expect(result.current.selectedRating).toBeNull();
    expect(result.current.isSaveVisible).toBe(false);
  });

  it('shows the saved note, not an unsaved choice, when the sheet reopens for another anime', () => {
    const initialProps = buildProps({ animeTitle: 'Anime A' });
    const { result, rerender } = renderHook(
      (p) => useSeasonRatingSheet(p as SeasonRatingSheetProps),
      { initialProps },
    );

    act(() => {
      result.current.handleSelectRating(4);
    });

    rerender({ ...initialProps, isOpen: false, animeTitle: '' });
    rerender({ ...initialProps, animeTitle: 'Anime C', bridgeRating: 2 });

    expect(result.current.selectedRating).toBe(2);
    expect(result.current.comparison).toBeNull();
  });

  it('compares the draft with the saved note only while they differ', () => {
    const { result } = renderHook(() =>
      useSeasonRatingSheet(buildProps({ bridgeRating: 3 })),
    );

    expect(result.current.comparison).toBeNull();
    expect(result.current.isSaveVisible).toBe(false);

    act(() => {
      result.current.handleSelectRating(5);
    });

    expect(result.current.comparison).toEqual({
      savedValueLabel: '3',
      draftValueLabel: '5',
      accessibilityLabel: 'Nota guardada 3. Nota nueva 5.',
    });
    expect(result.current.isSaveVisible).toBe(true);

    act(() => {
      result.current.handleSelectRating(3);
    });

    expect(result.current.comparison).toBeNull();
    expect(result.current.isSaveVisible).toBe(false);
  });

  it('offers the save action for a first note and never as a disabled control', () => {
    const { result } = renderHook(() => useSeasonRatingSheet(buildProps()));

    expect(result.current.isSaveVisible).toBe(false);

    act(() => {
      result.current.handleSelectRating(2);
    });

    expect(result.current.isSaveVisible).toBe(true);
    expect('isSubmitDisabled' in result.current).toBe(false);
  });

  it('does not repeat the anime title in the view model', () => {
    const { result } = renderHook(() =>
      useSeasonRatingSheet(buildProps({ animeTitle: 'Kaiju No. 8' })),
    );

    expect('animeTitle' in result.current).toBe(false);
  });

  it('closes on a dismissal request and ignores an open request', () => {
    const onClose = jest.fn();
    const { result } = renderHook(() =>
      useSeasonRatingSheet(buildProps({ onClose })),
    );

    act(() => {
      result.current.handleOpenChange(true);
    });

    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      result.current.handleOpenChange(false);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
