import type { SyncExecutionStrategy } from '../sync-execution-strategy.types';

/** Defines the data contract for create sync execution facade params. */
export interface CreateSyncExecutionFacadeParams {
  readonly strategies: readonly SyncExecutionStrategy[];
}

/** Defines the data contract for sync execution facade. */
export interface SyncExecutionFacade {
  readonly registerPreferredStrategy: () => Promise<void>;
  /**
   * Registers every strategy concurrently (non-exclusive): the WorkManager floor
   * and the FGS primary are both attempted, and the merged status exposes each
   * path's registration state independently.
   */
  readonly registerConcurrentStrategies: () => Promise<void>;
  readonly hasCurrentStrategy: () => boolean;
  readonly unregisterCurrentStrategy: () => Promise<void>;
  readonly getStatus: () => ReturnType<SyncExecutionStrategy['getStatus']>;
}
