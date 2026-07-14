import type { SyncSQLiteRuntime } from './sqlite-sync-runtime.types';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';

/** Defines the data contract for run headless sync cycle params. */
export interface RunHeadlessSyncCycleParams {
  readonly runtime: SyncSQLiteRuntime;
  readonly triggerSource: SyncRuntimeTriggerSource;
}

/** Defines the data contract for headless sync cycle result. */
export interface HeadlessSyncCycleResult {
  readonly kind: 'success' | 'failed' | 'no_op';
  readonly syncedCount: number;
}
