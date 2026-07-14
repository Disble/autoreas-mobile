import { useMemo } from 'react';
import { useSyncRuntime } from '../../../sync/use-sync-runtime';
import type { SyncRuntimeGateProps } from './sync-runtime-gate.types';
import { getSyncRuntimeGateLabel } from './sync-runtime-gate.helpers';

/** Coordinates sync runtime gate state and actions. */
export function useSyncRuntimeGate(props: SyncRuntimeGateProps) {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  useSyncRuntime({ isBootstrapped: props.isBootstrapped });

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)
  const label = useMemo(() => getSyncRuntimeGateLabel(props.label), [props.label]);
  const children = useMemo(() => props.children, [props.children]);

  // 6. Callbacks (useCallback calling pure helpers)

  // 7. Effects

  return {
    children,
    label,
  };
}
