import type { SyncExecutionStatus } from '../sync-execution-strategy.types';

/**
 * Defines the data contract for the native foreground-sync execution strategy. The adapter owns no
 * cycle-execution logic of its own: `register()`/`unregister()` only start/stop the
 * native ticker seam, which is what actually persists ticking state, arms the tick alarm and
 * starts/stops `SyncForegroundService` (Kotlin runs the whole attempt, including its own presence
 * gate).
 */
export interface NativeForegroundSyncAdapter {
  readonly register: () => Promise<void>;
  readonly unregister: () => Promise<void>;
  readonly getStatus: () => Promise<SyncExecutionStatus>;
}
