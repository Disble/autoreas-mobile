import { useThemeColor } from 'heroui-native';
import {
  buildSyncStatusAccessibilityLabel,
  deriveSyncStatusIndicator,
} from './sync-status-control.helpers';
import type { SyncStatusGlyphProps } from './sync-status-control.types';

/** Resolves the glyph, its theme color and the label the sync status glyph draws. */
export function useSyncStatusGlyph(props: SyncStatusGlyphProps) {
  // 5. Derived State
  const indicator = deriveSyncStatusIndicator(props.status);
  const accessibilityLabel = buildSyncStatusAccessibilityLabel(props.status);

  // 3. Context/3rd Party Hooks
  const color = useThemeColor(indicator.color);

  return { accessibilityLabel, color, indicator };
}
