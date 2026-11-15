import type { AppState } from 'react-native';

/** Defines the data contract for use sync runtime props. */
export interface UseSyncRuntimeProps {
  readonly isBootstrapped: boolean;
}

/** Defines the data contract for use sync runtime result. */
export interface UseSyncRuntimeResult {
  readonly currentAppState: (typeof AppState)['currentState'];
  readonly isRuntimeEnabled: boolean;
  readonly isWebSocketEnabled: boolean;
}
