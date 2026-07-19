import { act, renderHook } from '@testing-library/react-native';

jest.mock('heroui-native', () => ({
  useThemeColor: (tokens: readonly string[]) =>
    tokens.map((token) => `theme-${token}`),
}));

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

  it('mirrors the visible prop as the declarative isOpen flag', () => {
    const { result, rerender } = renderHook(
      (props: AnimeStateSheetProps) => useAnimeStateSheet(props),
      { initialProps: buildProps({ visible: false }) },
    );

    expect(result.current.isOpen).toBe(false);

    rerender(buildProps({ visible: true }));

    expect(result.current.isOpen).toBe(true);
  });

  it('exposes no imperative gorhom wiring once the sheet is HeroUI-driven', () => {
    const { result } = renderHook(() => useAnimeStateSheet(buildProps()));

    expect(result.current).not.toHaveProperty('sheetRef');
    expect(result.current).not.toHaveProperty('snapPoints');
    expect(result.current).not.toHaveProperty('renderBackdrop');
  });

  it('resolves icon colors from theme tokens instead of hardcoded hex', () => {
    const { result } = renderHook(() => useAnimeStateSheet(buildProps()));

    expect(Object.keys(result.current.toneIconColors).sort()).toEqual([
      'danger',
      'default',
      'success',
      'warning',
    ]);
    expect(result.current.selectedIconColor).toBe('theme-success');
    expect(result.current.toneIconColors.danger).toBe('theme-danger');
    expect(result.current.toneIconColors.default).toBe('theme-muted');
  });
});
