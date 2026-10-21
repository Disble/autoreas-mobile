import { useMemo } from 'react';
import { useSafeAreaFrame } from 'react-native-safe-area-context';

import { resolveLayoutMode } from './responsive-layout.helpers';
import type { LayoutMode } from './responsive-layout.types';

/**
 * Resolves the active layout mode from the measured root frame so the screen can pick the right slot.
 * Centralizing the breakpoints avoids per-component drift between phone, tablet-portrait, and tablet-landscape.
 *
 * Reads the frame the root `SafeAreaProvider` measures natively instead of `useWindowDimensions`:
 * on Android the window dimensions can keep reporting the split-screen window after the app
 * returns to full screen (no rotation happens, so React Native never re-reads them), which left a
 * full-screen tablet stuck in the compact layout without its day sidebar. The measured frame is
 * the size the screen is actually laid out at.
 */
export function useResponsiveLayout(): { layout: LayoutMode; isCompact: boolean; width: number } {
  const { width, height } = useSafeAreaFrame();

  return useMemo(() => {
    const layout = resolveLayoutMode(width, height);
    return { layout, isCompact: layout === 'phone', width };
  }, [width, height]);
}
