import type {
  CreateSyncExecutionFacadeParams,
  SyncExecutionFacade,
} from './sync-execution-facade.types';
import type {
  SyncExecutionStatus,
  SyncExecutionStrategy,
} from '../sync-execution-strategy.types';

/** Builds the safe status reported before any strategy has registered. */
function createFallbackStatus(): SyncExecutionStatus {
  return {
    registrationStatus: 'unsupported' as const,
    executionMode: 'best_effort_background_task' as const,
    isForegroundServiceRunning: false,
    canShowPersistentNotification: false,
    isBackgroundTaskRegistered: false,
    // Static like every other field here: no strategy has registered yet, so there is no live
    // seam to read through, unlike the adapter's own status builders.
    isBatteryOptimizationExempt: false,
  };
}

/**
 * Merges independently-tracked strategy statuses into one honest execution status.
 * Every flag is OR-ed across strategies so neither registration path becomes
 * structurally invisible while the other is active (per "Honest operational
 * visibility"); `executionMode` stays honest by preferring the FGS label only
 * when it is actually running.
 *
 * **`unsupported` survives the merge.** It answers a different question than `unregistered` does
 * ("this host cannot register a floor" vs "the floor is switched off"), so collapsing every
 * unsupported strategy into `unregistered` would destroy the only honest answer a host without any
 * native floor can give -- exactly what a device without the local native module reports. It is
 * preserved only when EVERY registered strategy says `unsupported`: a single real lifecycle answer
 * (`registered`/`unregistered`) wins over it, and a working path wins above all. An empty list is
 * unreachable through this facade (the merge only runs with at least one concurrent strategy) and
 * degrades to `unsupported` -- the same answer [createFallbackStatus] gives when nothing registered
 * at all.
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
  // Also OR-ed, not just the FGS-owning strategy's own reading: the exemption is a single
  // device-wide fact, so any strategy that read it as true is enough to report it true, and a
  // strategy that does not own this signal already reports its own safe `false`.
  const isBatteryOptimizationExempt = statuses.some(
    (status) => status.isBatteryOptimizationExempt,
  );
  // Read from the strategies' own `registrationStatus` (not from the flags) on purpose: the
  // verdict above already prefers a real flag, and this second read is the one that must notice
  // that no path can register anything.
  const isEveryPathUnsupported = statuses.every(
    (status) => status.registrationStatus === 'unsupported',
  );
  const isAnyPathRegistered = isForegroundServiceRunning || isBackgroundTaskRegistered;

  return {
    registrationStatus: isAnyPathRegistered
      ? 'registered'
      : isEveryPathUnsupported
        ? 'unsupported'
        : 'unregistered',
    executionMode: isForegroundServiceRunning
      ? 'android_foreground_service'
      : 'best_effort_background_task',
    isForegroundServiceRunning,
    canShowPersistentNotification,
    isBackgroundTaskRegistered,
    isBatteryOptimizationExempt,
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
  let concurrentRegistration: Promise<void> | null = null;
  let registrationGeneration = 0;

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
        return concurrentRegistration ?? undefined;
      }

      const generation = ++registrationGeneration;
      // Publish the status seams before initiating either asynchronous registration. A status
      // probe remains readable even if one register call never settles.
      concurrentStrategies = params.strategies;
      concurrentRegistration = Promise.all(
        params.strategies.map(async (strategy) => {
          try {
            await strategy.register();
          } catch {
            // One failed path must not block the other path's live status.
          } finally {
            // Disable can race a native enqueue. Cancel again after a late completion so it
            // cannot recreate work after unregisterCurrentStrategy has already returned.
            // The facade always registers this same strategy list. A newer enabled generation
            // owns it when the list is nonempty, so an older completion must leave it alone.
            if (
              generation !== registrationGeneration &&
              concurrentStrategies.length === 0
            ) {
              await strategy.unregister().catch(() => undefined);
            }
          }
        }),
      ).then(() => undefined);
      return concurrentRegistration;
    },

    hasCurrentStrategy() {
      return currentStrategy !== null || concurrentStrategies.length > 0;
    },

    async unregisterCurrentStrategy() {
      if (concurrentStrategies.length > 0) {
        const strategiesToUnregister = concurrentStrategies;
        registrationGeneration += 1;
        concurrentStrategies = [];
        concurrentRegistration = null;

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
