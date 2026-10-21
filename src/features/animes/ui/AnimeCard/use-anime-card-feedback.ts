import { useEffect, useRef } from 'react';
import {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';
import { COUNT_BUMP, PLUS_PULSE } from './anime-card.constants';
import { buildPeakAnimation } from './anime-card.helpers';

/**
 * Draws the card's answer to a chapter change: every change bumps the count (1 pt lift, accent
 * color) and an increase also pulses the plus button. The first render and reduce motion draw
 * nothing; the styles stay empty at rest so the classes keep their own color.
 */
export function useAnimeCardFeedback(watched: number) {
  // 1. Refs
  const previousWatchedRef = useRef(watched);

  // 3. Context/3rd Party Hooks
  const isReducedMotion = useReducedMotion();
  const [readingColor, accentColor] = useCSSVariable(['--color-reading', '--color-accent']);
  const bump = useSharedValue(0);
  const pulse = useSharedValue(0);

  // 5. Derived State
  const countStyle = useAnimatedStyle(() => {
    const progress = bump.get();
    if (progress === 0 || readingColor === undefined || accentColor === undefined) {
      return {};
    }
    return {
      color: interpolateColor(progress, [0, 1], [String(readingColor), String(accentColor)]),
    };
  });

  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -COUNT_BUMP.liftPt * bump.get() }],
  }));

  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (PLUS_PULSE.scale - 1) * pulse.get() }],
  }));

  // 7. Effects
  useEffect(() => {
    const previous = previousWatchedRef.current;
    previousWatchedRef.current = watched;
    if (watched === previous || isReducedMotion) {
      return;
    }
    bump.set(buildPeakAnimation(COUNT_BUMP.durationMs, COUNT_BUMP.peakAt));
    if (watched > previous) {
      pulse.set(buildPeakAnimation(PLUS_PULSE.durationMs, PLUS_PULSE.peakAt));
    }
  }, [bump, isReducedMotion, pulse, watched]);

  return { countStyle, lineStyle, plusStyle };
}
