import type { SyncExecutionStatus } from '../sync-execution-strategy.types';

/** Defines the data contract for notifee foreground service adapter. */
export interface NotifeeForegroundServiceAdapter {
  readonly mode: 'android_foreground_service';
  readonly register: () => Promise<void>;
  readonly unregister: () => Promise<void>;
  readonly getStatus: () => Promise<SyncExecutionStatus>;
}
