import type { SQLiteDatabase } from 'expo-sqlite';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';

export interface RunHeadlessSyncCycleParams {
  readonly rawDb: SQLiteDatabase;
  readonly triggerSource: SyncRuntimeTriggerSource;
}

export interface HeadlessSyncCycleResult {
  readonly kind: 'success' | 'failed' | 'no_op';
  readonly syncedCount: number;
}
