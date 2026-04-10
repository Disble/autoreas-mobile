import { act, renderHook } from '@testing-library/react-native';
import { useAnimeStateSheet } from '../../../src/features/animes/ui/AnimeStateSheet/use-anime-state-sheet';
import type { AnimeStateSheetProps } from '../../../src/features/animes/ui/AnimeStateSheet/anime-state-sheet.types';

function buildProps(overrides?: Partial<AnimeStateSheetProps>): AnimeStateSheetProps {
  return {
    visible: false,
    currentEstado: 0,
    onSelect: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
}

describe('useAnimeStateSheet', () => {
  it('exposes the four legacy estado options in display order', () => {
    const { result } = renderHook(() => useAnimeStateSheet(buildProps()));

    expect(result.current.options.map((option) => option.value)).toEqual([
      0,
      1,
      3,
      2,
    ]);
  });

  it('marks the current estado as selected', () => {
    const { result } = renderHook(() =>
      useAnimeStateSheet(buildProps({ currentEstado: 3 })),
    );

    const pausa = result.current.options.find((option) => option.value === 3);
    const viendo = result.current.options.find((option) => option.value === 0);
    expect(pausa?.isSelected).toBe(true);
    expect(viendo?.isSelected).toBe(false);
  });

  it('handleSelect fires onSelect then onClose when an option is picked', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const { result } = renderHook(() =>
      useAnimeStateSheet(buildProps({ onSelect, onClose })),
    );

    act(() => {
      result.current.handleSelect(1);
    });

    expect(onSelect).toHaveBeenCalledWith(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('handleClose forwards directly to onClose', () => {
    const onClose = jest.fn();
    const { result } = renderHook(() =>
      useAnimeStateSheet(buildProps({ onClose })),
    );

    act(() => {
      result.current.handleClose();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
