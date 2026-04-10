import React from 'react';
import type { SyncRuntimeGateProps } from './sync-runtime-gate.types';
import { useSyncRuntimeGate } from './use-sync-runtime-gate';

export function SyncRuntimeGate(props: SyncRuntimeGateProps) {
  const { children } = useSyncRuntimeGate(props);

  return <>{children}</>;
}
