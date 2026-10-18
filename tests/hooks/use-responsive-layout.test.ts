import { renderHook } from '@testing-library/react-native';
import { useResponsiveLayout } from '../../src/hooks/use-responsive-layout';

/** Stands in for the window dimensions React Native reports, which can go stale. */
const mockUseWindowDimensions = jest.fn();
/** Stands in for the root frame the safe-area provider measures natively. */
const mockUseSafeAreaFrame = jest.fn();

jest.mock('react-native', () => ({
  useWindowDimensions: () => mockUseWindowDimensions(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaFrame: () => mockUseSafeAreaFrame(),
}));

/** Feeds the same size to the measured root frame and to the window dimensions. */
function givenViewport(width: number, height: number): void {
  mockUseSafeAreaFrame.mockReturnValue({ x: 0, y: 0, width, height });
  mockUseWindowDimensions.mockReturnValue({ width, height });
}

describe('useResponsiveLayout', () => {
  beforeEach(() => {
    mockUseWindowDimensions.mockReset();
    mockUseSafeAreaFrame.mockReset();
  });

  it('returns phone layout when width is below 768', () => {
    givenViewport(360, 800);

    const { result } = renderHook(() => useResponsiveLayout());

    expect(result.current.layout).toBe('phone');
    expect(result.current.isCompact).toBe(true);
  });

  it('returns tablet-portrait when width is between 768 and 1279 in portrait', () => {
    givenViewport(820, 1180);

    const { result } = renderHook(() => useResponsiveLayout());

    expect(result.current.layout).toBe('tablet-portrait');
    expect(result.current.isCompact).toBe(false);
  });

  it('returns tablet-landscape when width is at least 1280', () => {
    givenViewport(1366, 1024);

    const { result } = renderHook(() => useResponsiveLayout());

    expect(result.current.layout).toBe('tablet-landscape');
    expect(result.current.isCompact).toBe(false);
  });

  it('returns tablet-landscape when width is at least 1024 and width exceeds height', () => {
    givenViewport(1180, 820);

    const { result } = renderHook(() => useResponsiveLayout());

    expect(result.current.layout).toBe('tablet-landscape');
  });

  it('treats the 768 boundary as tablet, not phone', () => {
    givenViewport(768, 1024);

    const { result } = renderHook(() => useResponsiveLayout());

    expect(result.current.layout).toBe('tablet-portrait');
  });

  it('follows the measured root frame when the window dimensions are stale after leaving split screen', () => {
    // Android can keep reporting the split-screen window after the app returns to full screen.
    mockUseWindowDimensions.mockReturnValue({ width: 640, height: 800 });
    mockUseSafeAreaFrame.mockReturnValue({ x: 0, y: 0, width: 1317, height: 824 });

    const { result } = renderHook(() => useResponsiveLayout());

    expect(result.current.layout).toBe('tablet-landscape');
  });

  it('follows the measured root frame when entering split screen', () => {
    mockUseWindowDimensions.mockReturnValue({ width: 1317, height: 824 });
    mockUseSafeAreaFrame.mockReturnValue({ x: 0, y: 0, width: 640, height: 824 });

    const { result } = renderHook(() => useResponsiveLayout());

    expect(result.current.layout).toBe('phone');
  });
});
