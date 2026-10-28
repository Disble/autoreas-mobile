import { HeaderHeightContext } from '@react-navigation/elements';
import { renderHook } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';
import useHeaderHeight from '../../../src/helpers/hooks/use-header-height';

/** Renders the hook inside a header height provider whose value the test can change. */
function renderWithHeaderHeight(initialHeight: number) {
  let height = initialHeight;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <HeaderHeightContext.Provider value={height}>{children}</HeaderHeightContext.Provider>
  );
  const rendered = renderHook(() => useHeaderHeight(), { wrapper });

  return {
    ...rendered,
    setHeight(next: number) {
      height = next;
      rendered.rerender(undefined);
    },
  };
}

describe('useHeaderHeight', () => {
  const originalOs = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOs;
  });

  it('follows the header once it reaches its real height on Android, instead of keeping the first value', () => {
    // On the tablet the first value was 86 pt while the header settled at 94 pt, so content sat
    // under the last 8 pt of the header (odd/tasks/expo-sdk-upgrade.md L10).
    Platform.OS = 'android';
    const { result, setHeight } = renderWithHeaderHeight(86);

    setHeight(94);

    expect(result.current).toBe(94);
  });

  it('returns the measured header height on iOS', () => {
    Platform.OS = 'ios';
    const { result, setHeight } = renderWithHeaderHeight(100);

    setHeight(110);

    expect(result.current).toBe(110);
  });
});
