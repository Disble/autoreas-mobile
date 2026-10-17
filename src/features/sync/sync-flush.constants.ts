import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';
import type { SyncFlushDispatcher, SyncFlushReason, SyncFlushState } from './sync-flush.types';

/**
 * The trigger source each flush reason is persisted as. The WebSocket season events are a sync the
 * bridge asked for, and a season rating is a local mutation, so the persisted vocabulary (shared
 * with Kotlin through `sync_runtime_status`) does not grow.
 */
export const SYNC_FLUSH_REASON_SOURCES: Readonly<Record<SyncFlushReason, SyncRuntimeTriggerSource>> = {
  bootstrap: 'bootstrap',
  manual: 'manual',
  app_active: 'app_active',
  network_regained: 'network_regained',
  ws_sync_required: 'ws_sync_required',
  ws_season_changed: 'ws_sync_required',
  ws_preferences_changed: 'ws_sync_required',
  local_mutation: 'local_mutation',
  season_rating: 'local_mutation',
};

/** The reasons that also demand an active-season refresh from the dispatched cycle (ADR 009 I8). */
export const ACTIVE_SEASON_REFRESH_FLUSH_REASONS: ReadonlySet<SyncFlushReason> = new Set<SyncFlushReason>([
  'ws_season_changed',
  'ws_preferences_changed',
]);

/** Holds the registered JS dispatcher; `null` while the foreground runtime is not mounted. */
export const SYNC_FLUSH_DISPATCHER: { current: SyncFlushDispatcher | null } = { current: null };

/** Holds each database's single-flight state while a cycle runs. */
export const SYNC_FLUSH_STATES = new Map<object, SyncFlushState>();
