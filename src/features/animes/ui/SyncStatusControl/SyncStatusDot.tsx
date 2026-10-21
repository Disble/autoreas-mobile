import Animated from 'react-native-reanimated';
import type { SyncStatusDotProps } from './sync-status-control.types';
import { useSyncStatusDot } from './use-sync-status-dot';

/** Renders the 8 pt status dot, breathing while a sync runs. */
export function SyncStatusDot({ color, isBreathing }: Readonly<SyncStatusDotProps>) {
  const { style } = useSyncStatusDot(color, isBreathing);

  return <Animated.View style={style} />;
}
