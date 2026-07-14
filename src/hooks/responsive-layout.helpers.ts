import { LANDSCAPE_MIN_WIDTH, LARGE_TABLET_BREAKPOINT, PHONE_BREAKPOINT } from './responsive-layout.constants';
import type { LayoutMode } from './responsive-layout.types';

/** Resolves a stable layout mode from viewport dimensions. */
export function resolveLayoutMode(width: number, height: number): LayoutMode {
  if (width < PHONE_BREAKPOINT) return 'phone';
  if (width >= LARGE_TABLET_BREAKPOINT) return 'tablet-landscape';
  if (width >= LANDSCAPE_MIN_WIDTH && width > height) return 'tablet-landscape';
  return 'tablet-portrait';
}
