import type { AppStateStatus } from 'react-native';
import type { SyncExecutionMode } from './sync-execution-mode.types';

/** Defines the data contract for use sync runtime props. */
export interface UseSyncRuntimeProps {
  readonly isBootstrapped: boolean;
}

/** Defines the data contract for use sync runtime result. */
export interface UseSyncRuntimeResult {
  readonly currentAppState: AppStateStatus;
  readonly executionMode: SyncExecutionMode;
  readonly isRuntimeEnabled: boolean;
  readonly isWebSocketEnabled: boolean;
}
