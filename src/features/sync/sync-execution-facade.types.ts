import type { SyncExecutionStrategy } from './sync-execution-strategy.types';

export interface CreateSyncExecutionFacadeParams {
  readonly strategies: readonly SyncExecutionStrategy[];
}

export interface SyncExecutionFacade {
  readonly registerPreferredStrategy: () => Promise<void>;
  readonly hasCurrentStrategy: () => boolean;
  readonly unregisterCurrentStrategy: () => Promise<void>;
  readonly getStatus: () => ReturnType<SyncExecutionStrategy['getStatus']>;
}
