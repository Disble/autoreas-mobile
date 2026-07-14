import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { resolveLayoutMode } from './responsive-layout.helpers';
import type { LayoutMode } from './responsive-layout.types';

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
