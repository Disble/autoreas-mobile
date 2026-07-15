import type { SyncRuntimeGateProps } from './sync-runtime-gate.types';
import { useSyncRuntimeGate } from './use-sync-runtime-gate';

/** Renders the sync runtime gate interface. */
export function SyncRuntimeGate(props: Readonly<SyncRuntimeGateProps>) {
  const { children } = useSyncRuntimeGate(props);

  return <>{children}</>;
}
