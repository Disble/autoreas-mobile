import type { SnapshotHealDemand } from './snapshot-heal.types';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';
import type { SyncFlushDispatcher, SyncFlushReason, SyncFlushState } from './sync-flush.types';

/**
 * The trigger source each flush reason is persisted as. The WebSocket season events and a socket
 * reconnect or drop are a sync the bridge asked for, and a season rating is a local mutation, so the persisted vocabulary (shared
 * with Kotlin through `sync_runtime_status`) does not grow.
 */
export const SYNC_FLUSH_REASON_SOURCES: Readonly<Record<SyncFlushReason, SyncRuntimeTriggerSource>> = {
  bootstrap: 'bootstrap',
  manual: 'manual',
  app_active: 'app_active',
  network_regained: 'network_regained',
  ws_sync_required: 'ws_sync_required',
  ws_reconnected: 'ws_sync_required',
  ws_disconnected: 'ws_sync_required',
  ws_season_changed: 'ws_sync_required',
  ws_preferences_changed: 'ws_sync_required',
  local_mutation: 'local_mutation',
  season_rating: 'local_mutation',
};

/**
 * The reasons that also demand an active-season refresh from the dispatched cycle (ADR 009 I8).
 * `app_active` is one because the Kotlin engine may have delivered a rating while the app was in
 * the background, and only a refresh shows the bridge's recorded value (L28).
 */
export const ACTIVE_SEASON_REFRESH_FLUSH_REASONS: ReadonlySet<SyncFlushReason> = new Set<SyncFlushReason>([
  'ws_season_changed',
  'ws_preferences_changed',
  'app_active',
]);

/**
 * The full-snapshot heal each flush reason demands (ADR 009 R-7): mount (`bootstrap`) and resume
 * (`app_active`) always heal; a WebSocket reconnect heals only when the last successful heal is
 * stale. Every other reason pulls since the cursor without the snapshot; a socket drop
 * (`ws_disconnected`) only re-checks the bridge (ADR 009 R-9).
 */
export const SNAPSHOT_HEAL_FLUSH_DEMANDS: Readonly<Record<SyncFlushReason, SnapshotHealDemand>> = {
  bootstrap: 'always',
  manual: 'never',
  app_active: 'always',
  network_regained: 'never',
  ws_sync_required: 'never',
  ws_reconnected: 'if_stale',
  ws_disconnected: 'never',
  ws_season_changed: 'never',
  ws_preferences_changed: 'never',
  local_mutation: 'never',
  season_rating: 'never',
};

/** Holds the registered JS dispatcher; `null` while the foreground runtime is not mounted. */
export const SYNC_FLUSH_DISPATCHER: { current: SyncFlushDispatcher | null } = { current: null };

/** Holds each database's single-flight state while a cycle runs. */
export const SYNC_FLUSH_STATES = new Map<object, SyncFlushState>();
