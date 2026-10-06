import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { BatteryOptimizationExemption } from '../../../sync/native-battery-optimization.types';
import type { BatteryExemptionForegroundState } from './battery-exemption-prompt.types';

/**
 * Tracks the two prompt inputs that live outside SQLite: whether the app is exempt and the instant
 * the decision is evaluated at. Both are re-read when the app returns to the foreground, because
 * that is when the user may have granted or revoked the exemption in system settings and when
 * time has passed for the reminder's silence window.
 */
export function useBatteryExemptionForegroundState(
  exemption: BatteryOptimizationExemption,
): BatteryExemptionForegroundState {
  // 1. Refs

  // 2. State
  const [isExempt, setIsExempt] = useState(() => exemption.isExempt());
  const [evaluatedAt, setEvaluatedAt] = useState(() => Date.now());

  // 3. Context/3rd Party Hooks

  // 4. Queries/Mutations

  // 5. Derived State

  // 6. Callbacks

  // 7. Effects
  useEffect(() => {
    // Only `active` re-reads: leaving the app cannot have changed the grant.
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active') {
        return;
      }

      setIsExempt(exemption.isExempt());
      setEvaluatedAt(Date.now());
    });

    return () => {
      subscription.remove();
    };
  }, [exemption]);

  return { isExempt, evaluatedAt };
}
