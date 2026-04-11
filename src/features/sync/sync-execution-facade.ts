import type {
  CreateSyncExecutionFacadeParams,
  SyncExecutionFacade,
} from './sync-execution-facade.types';
import type { SyncExecutionStrategy } from './sync-execution-strategy.types';

function createFallbackStatus() {
  return {
    registrationStatus: 'unsupported' as const,
    executionMode: 'best_effort_background_task' as const,
    isForegroundServiceRunning: false,
    canShowPersistentNotification: false,
  };
}

/**
 * Creates the application-level facade that selects and exposes the active sync execution strategy.
 * The facade is functional and stateful via closure, avoiding classes while still giving the runtime one stable interface.
 */
export function createSyncExecutionFacade(
  params: CreateSyncExecutionFacadeParams,
): SyncExecutionFacade {
  let currentStrategy: SyncExecutionStrategy | null = null;

  return {
    async registerPreferredStrategy() {
      for (const strategy of params.strategies) {
        await strategy.register();
        const status = await strategy.getStatus();

        if (status.registrationStatus === 'registered') {
          currentStrategy = strategy;
          return;
        }
      }

      currentStrategy = params.strategies.at(-1) ?? null;
    },

    async unregisterCurrentStrategy() {
      if (!currentStrategy) {
        return;
      }

      await currentStrategy.unregister();
    },

    async getStatus() {
      if (!currentStrategy) {
        return createFallbackStatus();
      }

      return currentStrategy.getStatus();
    },
  };
}
