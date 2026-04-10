import type { ReactNode } from 'react';

export interface SyncRuntimeGateProps {
  readonly children: ReactNode;
  readonly isBootstrapped: boolean;
  readonly label?: string | null;
}
