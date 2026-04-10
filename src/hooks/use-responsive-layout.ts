import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

export type LayoutMode = 'phone' | 'tablet-portrait' | 'tablet-landscape';

const PHONE_BREAKPOINT = 768;
const LANDSCAPE_MIN_WIDTH = 1024;
const LARGE_TABLET_BREAKPOINT = 1280;

/**
 * Resolves the active layout mode from the window dimensions so the screen can pick the right slot.
 * Centralizing the breakpoints avoids per-component drift between phone, tablet-portrait, and tablet-landscape.
 */
export function useResponsiveLayout(): { layout: LayoutMode; isCompact: boolean } {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const layout = resolveLayoutMode(width, height);
    return { layout, isCompact: layout === 'phone' };
  }, [width, height]);
}

function resolveLayoutMode(width: number, height: number): LayoutMode {
  if (width < PHONE_BREAKPOINT) {
    return 'phone';
  }

  if (width >= LARGE_TABLET_BREAKPOINT) {
    return 'tablet-landscape';
  }

  if (width >= LANDSCAPE_MIN_WIDTH && width > height) {
    return 'tablet-landscape';
  }

  return 'tablet-portrait';
}
