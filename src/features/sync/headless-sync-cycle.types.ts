import type { SyncSQLiteRuntime } from './sqlite-sync-runtime.types';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';

export interface RunHeadlessSyncCycleParams {
  readonly runtime: SyncSQLiteRuntime;
  readonly triggerSource: SyncRuntimeTriggerSource;
}

export interface HeadlessSyncCycleResult {
  readonly kind: 'success' | 'failed' | 'no_op';
  readonly syncedCount: number;
}
