import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { createNativeBatteryOptimizationExemption } from '../../../sync/native-battery-optimization.helpers';
import type { UseSettingsScreenBatteryExemptionResult } from './settings-screen.types';

/**
 * Tracks whether the app is currently exempt from Android's battery-optimization restrictions,
 * and exposes the action that requests the exemption from Settings. Extracted as a facade hook
 * (per the project's Facade Hook pattern) so `useSettingsScreen` stays under its complexity and
 * line budget.
 *
 * The exemption is an OS-level fact with no meaningful cached value to hold between reads -- see
 * `SyncExecutionStatus.isBatteryOptimizationExempt`'s own doc for why the adapter reads it fresh
 * too -- so this hook re-reads `isExempt()` on mount and again after every request, rather than
 * trusting a stale answer the user could have changed through the system dialog.
 */
export function useSettingsScreenBatteryExemption(): UseSettingsScreenBatteryExemptionResult {
  // 1. Refs

  // 2. State
  const [isBatteryOptimizationExempt, setIsBatteryOptimizationExempt] = useState(
    () => createNativeBatteryOptimizationExemption().isExempt(),
  );

  // 3. Context/3rd Party Hooks

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)

  // 6. Callbacks (useCallback calling pure helpers)
  const handleRequestBatteryExemption = useCallback(() => {
    const exemption = createNativeBatteryOptimizationExemption();

    // requestExemption() only reports whether the system dialog launched, never whether the
    // user granted it (see the native seam's own doc), so the next state comes from re-reading
    // isExempt() regardless of what the request itself answered.
    exemption.requestExemption();
    setIsBatteryOptimizationExempt(exemption.isExempt());
  }, []);

  // 7. Effects
  useEffect(() => {
    // `requestExemption()` only launches the system dialog, which takes the user OUT of the app
    // before they decide anything -- so the read taken right after that call still sees the
    // pre-decision state. The grant only becomes observable once the app comes back. Without
    // this re-check, the single screen that reports the exemption would keep saying "not exempt"
    // immediately after the user granted it, which reads as the keystone mechanism being broken.
    // Only `active` re-reads: a transition to `background` or `inactive` cannot have changed the
    // grant, and re-reading there would churn state on every app switch.
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active') {
        return;
      }

      setIsBatteryOptimizationExempt(createNativeBatteryOptimizationExemption().isExempt());
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return { isBatteryOptimizationExempt, handleRequestBatteryExemption };
}
