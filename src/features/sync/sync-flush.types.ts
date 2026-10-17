import type { SQLiteDatabase } from 'expo-sqlite';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';

/**
 * Why a caller asks the JS dispatcher to flush (ADR 009 R-2). Callers name their reason and never
 * which kinds exist or how they leave: every reason maps onto one persisted trigger source and,
 * for the WebSocket season events, onto a demand to refresh the active season.
 */
export type SyncFlushReason =
  | 'bootstrap'
  | 'manual'
  | 'app_active'
  | 'network_regained'
  | 'ws_sync_required'
  | 'ws_season_changed'
  | 'ws_preferences_changed'
  | 'local_mutation'
  | 'season_rating';

/** The one request the dispatcher receives for a run, merged from every reason it serves. */
export interface SyncFlushRequest {
  readonly database: SQLiteDatabase;
  readonly source: SyncRuntimeTriggerSource;
  readonly refreshActiveSeason: boolean;
}

/** The single JS exit: runs one coordinated cycle and resolves its confirmed operation count. */
export type SyncFlushDispatcher = (request: SyncFlushRequest) => Promise<number>;

/** The one follow-up run queued behind a running cycle, shared by every request it absorbs. */
export interface SyncFlushFollowUp {
  readonly reasons: SyncFlushReason[];
  readonly promise: Promise<number>;
  readonly resolve: (syncedCount: number) => void;
  readonly reject: (reason: unknown) => void;
}

/** The per-database single-flight state: the running cycle and at most one follow-up. */
export interface SyncFlushState {
  readonly running: Promise<number>;
  followUp: SyncFlushFollowUp | null;
}
