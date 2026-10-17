import type { SyncConnectionStatus } from './sync-connection-store/sync-connection-store.types';

/**
 * Defines the status the sync facade exposes: the shared store's kinds plus `reachable`, which the
 * facade derives when no cycle runs and the latest exchange in either runtime reached the bridge
 * (ADR 009 R-9). The store itself never publishes `reachable`.
 */
export type SyncFacadeConnectionStatus = SyncConnectionStatus | 'reachable';

/**
 * Defines the two `sync_runtime_status` columns read as reachability evidence. Both runtimes write
 * that singleton row; a success writes the same instant to both columns.
 */
export interface SyncRuntimeReachabilityEvidence {
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
}
