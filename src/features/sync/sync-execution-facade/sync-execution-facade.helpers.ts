import type {
  CreateSyncExecutionFacadeParams,
  SyncExecutionFacade,
} from './sync-execution-facade.types';
import type {
  SyncExecutionStatus,
  SyncExecutionStrategy,
} from '../sync-execution-strategy.types';

function createFallbackStatus(): SyncExecutionStatus {
  return {
    registrationStatus: 'unsupported' as const,
    executionMode: 'best_effort_background_task' as const,
    isForegroundServiceRunning: false,
    canShowPersistentNotification: false,
    isBackgroundTaskRegistered: false,
  };
}

/**
 * Merges independently-tracked strategy statuses into one honest execution status.
 * Every flag is OR-ed across strategies so neither registration path becomes
 * structurally invisible while the other is active (per "Honest operational
 * visibility"); `executionMode` stays honest by preferring the FGS label only
 * when it is actually running.
 */
function mergeConcurrentSyncExecutionStatus(
  statuses: readonly SyncExecutionStatus[],
): SyncExecutionStatus {
  const isForegroundServiceRunning = statuses.some(
    (status) => status.isForegroundServiceRunning,
  );
  const isBackgroundTaskRegistered = statuses.some(
    (status) => status.isBackgroundTaskRegistered,
  );
  const canShowPersistentNotification = statuses.some(
    (status) => status.canShowPersistentNotification,
  );
  const isAnyPathRegistered = isForegroundServiceRunning || isBackgroundTaskRegistered;

  return {
    registrationStatus: isAnyPathRegistered ? 'registered' : 'unregistered',
    executionMode: isForegroundServiceRunning
      ? 'android_foreground_service'
      : 'best_effort_background_task',
    isForegroundServiceRunning,
    canShowPersistentNotification,
    isBackgroundTaskRegistered,
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
  let concurrentStrategies: readonly SyncExecutionStrategy[] = [];

  return {
    async registerPreferredStrategy() {
      if (currentStrategy) {
        return;
      }

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

    async registerConcurrentStrategies() {
      if (concurrentStrategies.length > 0) {
        return;
      }

      // Each strategy registers independently (opportunistic FGS, mandatory
      // WorkManager floor); a failure on one path must not block the other.
      await Promise.all(
        params.strategies.map((strategy) => strategy.register().catch(() => undefined)),
      );

      concurrentStrategies = params.strategies;
    },

    hasCurrentStrategy() {
      return currentStrategy !== null || concurrentStrategies.length > 0;
    },

    async unregisterCurrentStrategy() {
      if (concurrentStrategies.length > 0) {
        const strategiesToUnregister = concurrentStrategies;
        concurrentStrategies = [];

        await Promise.all(
          strategiesToUnregister.map((strategy) => strategy.unregister().catch(() => undefined)),
        );
        return;
      }

      if (!currentStrategy) {
        return;
      }

      await currentStrategy.unregister();
      currentStrategy = null;
    },

    async getStatus() {
      if (concurrentStrategies.length > 0) {
        const statuses = await Promise.all(
          concurrentStrategies.map((strategy) => strategy.getStatus()),
        );

        return mergeConcurrentSyncExecutionStatus(statuses);
      }

      if (!currentStrategy) {
        return createFallbackStatus();
      }

      return currentStrategy.getStatus();
    },
  };
}
