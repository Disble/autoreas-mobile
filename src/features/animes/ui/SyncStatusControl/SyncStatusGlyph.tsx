import { Ionicons } from '@expo/vector-icons';
import { SyncStatusDot } from './SyncStatusDot';
import { SYNC_STATUS_GLYPH_ICON } from './sync-status-control.constants';
import type { SyncStatusGlyphProps } from './sync-status-control.types';
import { useSyncStatusGlyph } from './use-sync-status-button';

/** Renders the dot, or the icon that replaces it when no sync can run. */
export function SyncStatusGlyph(props: Readonly<SyncStatusGlyphProps>) {
  const { color, indicator } = useSyncStatusGlyph(props);

  if (indicator.glyph === 'dot') {
    return <SyncStatusDot color={color} isBreathing={indicator.isBreathing} />;
  }
  return <Ionicons color={color} name={SYNC_STATUS_GLYPH_ICON[indicator.glyph]} size={20} />;
}
