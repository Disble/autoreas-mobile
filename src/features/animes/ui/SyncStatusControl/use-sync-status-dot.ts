import { useEffect, useMemo } from 'react';
import {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {
  SYNC_STATUS_BREATH_DURATION_MS,
  SYNC_STATUS_BREATH_MIN_OPACITY,
  SYNC_STATUS_BREATH_MIN_SCALE,
} from './sync-status-control.constants';

/**
 * Drives the sync dot's breath on the UI thread while a sync runs. With reduce motion on, or once
 * the sync settles, the dot rests at full opacity and size.
 */
export function useSyncStatusDot(color: string, isBreathing: boolean) {
  // 3. Context/3rd Party Hooks
  const isReducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  // 5. Derived State
  const shouldBreathe = isBreathing && !isReducedMotion;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, SYNC_STATUS_BREATH_MIN_OPACITY]),
    transform: [
      { scale: interpolate(progress.value, [0, 1], [1, SYNC_STATUS_BREATH_MIN_SCALE]) },
    ],
  }));

  const style = useMemo(
    () => [{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }, animatedStyle],
    [animatedStyle, color],
  );

  // 7. Effects
  useEffect(() => {
    if (!shouldBreathe) {
      cancelAnimation(progress);
      progress.set(0);
      return;
    }
    progress.set(withRepeat(
      withTiming(1, { duration: SYNC_STATUS_BREATH_DURATION_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    ));
    return () => cancelAnimation(progress);
  }, [progress, shouldBreathe]);

  return { style };
}
