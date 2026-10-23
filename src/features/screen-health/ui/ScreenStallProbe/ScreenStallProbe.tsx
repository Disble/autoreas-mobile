import { View } from 'react-native';
import type { ScreenStallProbeProps } from './screen-stall-probe.types';
import { useScreenStallProbe } from './use-screen-stall-probe';

/**
 * Wraps the app to watch how fast the screen paints. It only observes the touches that bubble
 * through it and renders one invisible, untouchable probe view; it never takes a touch itself.
 */
export function ScreenStallProbe(props: ScreenStallProbeProps) {
  const { probeKey, handleTouchStart, handleProbeLayout } = useScreenStallProbe(props);

  return (
    <View className="flex-1" onTouchStart={handleTouchStart}>
      {props.children}
      <View
        key={probeKey}
        testID="screen-stall-probe"
        onLayout={handleProbeLayout}
        pointerEvents="none"
        className="absolute left-0 top-0 h-px w-px opacity-0"
      />
    </View>
  );
}
