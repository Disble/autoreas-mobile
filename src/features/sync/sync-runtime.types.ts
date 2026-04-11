import type { AppStateStatus } from 'react-native';
import type { SyncExecutionMode } from './sync-execution-mode.types';

export interface UseSyncRuntimeProps {
  readonly isBootstrapped: boolean;
}

export interface UseSyncRuntimeResult {
  readonly currentAppState: AppStateStatus;
  readonly executionMode: SyncExecutionMode;
  readonly isRuntimeEnabled: boolean;
  readonly isWebSocketEnabled: boolean;
}
