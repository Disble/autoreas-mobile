import type { SyncExecutionStrategy } from '../sync-execution-strategy.types';

/** Defines the data contract for create sync execution facade params. */
export interface CreateSyncExecutionFacadeParams {
  readonly strategies: readonly SyncExecutionStrategy[];
}

/** Defines the data contract for sync execution facade. */
export interface SyncExecutionFacade {
  readonly registerPreferredStrategy: () => Promise<void>;
  readonly hasCurrentStrategy: () => boolean;
  readonly unregisterCurrentStrategy: () => Promise<void>;
  readonly getStatus: () => ReturnType<SyncExecutionStrategy['getStatus']>;
}
