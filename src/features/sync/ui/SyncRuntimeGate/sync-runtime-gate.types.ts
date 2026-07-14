import type { ReactNode } from 'react';

/** Defines the data contract for sync runtime gate props. */
export interface SyncRuntimeGateProps {
  readonly children: ReactNode;
  readonly isBootstrapped: boolean;
  readonly label?: string | null;
}
