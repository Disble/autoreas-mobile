import type { AppStateStatus } from 'react-native';

export interface UseSyncRuntimeProps {
  readonly isBootstrapped: boolean;
}

export interface UseSyncRuntimeResult {
  readonly currentAppState: AppStateStatus;
  readonly isRuntimeEnabled: boolean;
  readonly isWebSocketEnabled: boolean;
}
