import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Dimensions, useWindowDimensions } from 'react-native';
import { useBridgeConfig } from '../../../settings/use-bridge-config';
import { isSyncTelemetryEnabled } from '../../../sync/sync-telemetry-preference.helpers';
import {
  appendScreenStallTransition,
  buildScreenStallWirePayload,
  recordScreenStall,
  toScreenStallAppState,
} from '../../screen-stall.helpers';
import type {
  ScreenStallAppState,
  ScreenStallProbeStart,
  ScreenStallSize,
  ScreenStallTransition,
  ScreenStallTrigger,
} from '../../screen-stall.types';
import type { ScreenStallProbeProps } from './screen-stall-probe.types';

/**
 * Measures how long the screen takes to paint a change after a touch, a resume, a window focus or
 * a resize, and reports the ones that take two seconds or more.
 *
 * The probe re-mounts one invisible view and waits for its `onLayout`: that round trip crosses the
 * JS commit, the native mount and the layout event back, which is exactly the path that stalled
 * while every button looked dead. It arms on events only, never on a timer, and while one probe is
 * pending a new event does not re-arm it, so a stall is measured from its first unanswered event.
 */
export function useScreenStallProbe(_props: ScreenStallProbeProps) {
  // 1. Refs
  const pendingProbeRef = useRef<ScreenStallProbeStart | null>(null);
  const transitionsRef = useRef<readonly ScreenStallTransition[]>([]);
  const windowFocusedRef = useRef<boolean | null>(null);
  // Kept from the change events themselves: `AppState.currentState` is not guaranteed to have
  // moved yet inside a listener of the event that moves it. `null` until the first change event.
  const appStateRef = useRef<ScreenStallAppState | null>(null);
  const previousWindowRef = useRef<ScreenStallSize | null>(null);

  // 2. State
  const [probeKey, setProbeKey] = useState(0);

  // 3. Context/3rd Party Hooks
  const { width, height } = useWindowDimensions();
  const { config } = useBridgeConfig();

  // 5. Derived State
  const isTelemetryEnabled = isSyncTelemetryEnabled(config);

  // 6. Callbacks
  const armProbe = useCallback(
    (trigger: ScreenStallTrigger) => {
      if (pendingProbeRef.current) {
        return;
      }

      // The physical screen, read at the event: `useWindowDimensions` only knows the window, and
      // the window being smaller than the screen is what tells split screen apart. Read once per
      // probe, never kept for layout, so it cannot go stale.
      // eslint-disable-next-line react-doctor/rn-no-dimensions-get -- no hook exposes the screen size
      const screen = Dimensions.get('screen');
      pendingProbeRef.current = {
        trigger,
        armedAtMs: Date.now(),
        appState: appStateRef.current ?? toScreenStallAppState(AppState.currentState),
        windowFocused: windowFocusedRef.current,
        windowSize: { width, height },
        screenSize: { width: screen.width, height: screen.height },
      };
      setProbeKey((key) => key + 1);
    },
    [width, height],
  );

  const recordTransition = useCallback((event: ScreenStallTransition['event']) => {
    transitionsRef.current = appendScreenStallTransition(transitionsRef.current, {
      event,
      atMs: Date.now(),
    });
  }, []);

  const handleTouchStart = useCallback(() => {
    armProbe('touch');
  }, [armProbe]);

  const handleProbeLayout = useCallback(() => {
    const start = pendingProbeRef.current;
    pendingProbeRef.current = null;
    if (!start || !isTelemetryEnabled) {
      return;
    }

    const payload = buildScreenStallWirePayload(
      start,
      Date.now(),
      transitionsRef.current,
      Crypto.randomUUID(),
    );
    if (payload) {
      recordScreenStall(payload);
    }
  }, [isTelemetryEnabled]);

  // 7. Effects
  useEffect(() => {
    const changeSubscription = AppState.addEventListener('change', (nextState) => {
      const appState = toScreenStallAppState(nextState);
      appStateRef.current = appState;
      if (appState !== 'unknown') {
        recordTransition(appState);
      }

      if (nextState === 'active') {
        armProbe('app_active');
        return;
      }

      // A backgrounded app does not paint by design; a probe left pending would report the time
      // spent away as a stall.
      pendingProbeRef.current = null;
    });
    const focusSubscription = AppState.addEventListener('focus', () => {
      windowFocusedRef.current = true;
      recordTransition('focus');
      armProbe('focus');
    });
    const blurSubscription = AppState.addEventListener('blur', () => {
      windowFocusedRef.current = false;
      recordTransition('blur');
    });

    return () => {
      changeSubscription.remove();
      focusSubscription.remove();
      blurSubscription.remove();
    };
  }, [armProbe, recordTransition]);

  useEffect(() => {
    const previous = previousWindowRef.current;
    previousWindowRef.current = { width, height };
    if (!previous || (previous.width === width && previous.height === height)) {
      return;
    }

    recordTransition('resize');
    armProbe('resize');
  }, [width, height, armProbe, recordTransition]);

  return {
    probeKey,
    handleTouchStart,
    handleProbeLayout,
  };
}
