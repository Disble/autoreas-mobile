import { useNetworkState } from 'expo-network';
import { useMemo } from 'react';

/**
 * Resolves whether the device currently has network connectivity, preferring the
 * internet-reachability signal and falling back to raw connectivity when it is unknown.
 * Extracted as a facade hook (per the project's Facade Hook pattern) so `useSettingsScreen`
 * stays under its complexity and line budget.
 */
export function useSettingsScreenDeviceOnline(): boolean | null {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const networkState = useNetworkState();

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)
  const isDeviceOnline = useMemo(() => {
    if (typeof networkState.isInternetReachable === 'boolean') {
      return networkState.isInternetReachable;
    }

    if (typeof networkState.isConnected === 'boolean') {
      return networkState.isConnected;
    }

    return null;
  }, [networkState.isConnected, networkState.isInternetReachable]);

  // 6. Callbacks (useCallback calling pure helpers)

  // 7. Effects

  return isDeviceOnline;
}
