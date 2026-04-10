import { renderHook } from '@testing-library/react-native';
import { useResponsiveLayout } from '../../src/hooks/use-responsive-layout';

const mockUseWindowDimensions = jest.fn();

jest.mock('react-native', () => ({
  useWindowDimensions: () => mockUseWindowDimensions(),
}));

describe('useResponsiveLayout', () => {
  beforeEach(() => {
    mockUseWindowDimensions.mockReset();
  });

  it('returns phone layout when width is below 768', () => {
    mockUseWindowDimensions.mockReturnValue({ width: 360, height: 800 });

    const { result } = renderHook(() => useResponsiveLayout());

    expect(result.current.layout).toBe('phone');
    expect(result.current.isCompact).toBe(true);
  });

  it('returns tablet-portrait when width is between 768 and 1279 in portrait', () => {
    mockUseWindowDimensions.mockReturnValue({ width: 820, height: 1180 });

    const { result } = renderHook(() => useResponsiveLayout());

    expect(result.current.layout).toBe('tablet-portrait');
    expect(result.current.isCompact).toBe(false);
  });

  it('returns tablet-landscape when width is at least 1280', () => {
    mockUseWindowDimensions.mockReturnValue({ width: 1366, height: 1024 });

    const { result } = renderHook(() => useResponsiveLayout());

    expect(result.current.layout).toBe('tablet-landscape');
    expect(result.current.isCompact).toBe(false);
  });

  it('returns tablet-landscape when width is at least 1024 and width exceeds height', () => {
    mockUseWindowDimensions.mockReturnValue({ width: 1180, height: 820 });

    const { result } = renderHook(() => useResponsiveLayout());

    expect(result.current.layout).toBe('tablet-landscape');
  });

  it('treats the 768 boundary as tablet, not phone', () => {
    mockUseWindowDimensions.mockReturnValue({ width: 768, height: 1024 });

    const { result } = renderHook(() => useResponsiveLayout());

    expect(result.current.layout).toBe('tablet-portrait');
  });
});
