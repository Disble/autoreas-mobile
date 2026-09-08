import type { SQLiteDatabase } from 'expo-sqlite';

/** Row shape of a diagnostics outbox candidate, exactly as SQLite returns it. */
export interface SyncDiagnosticsOutboxRow {
  readonly cycle_id: string;
  readonly payload: string;
  readonly created_at: number;
}

/** Options the diagnostics outbox store passes to its own opener; mirrors the checkpoint's shape. */
export interface OpenSyncDiagnosticsOutboxDatabaseParams {
  readonly databaseName: string;
  readonly useNewConnection: boolean;
  readonly enableChangeListener: boolean;
  readonly busyTimeoutMs: number;
}

/** Defines the dependencies for the diagnostics outbox store. */
export interface SyncDiagnosticsOutboxStoreParams {
  readonly openDatabase?: (
    options: OpenSyncDiagnosticsOutboxDatabaseParams,
  ) => SQLiteDatabase;
  readonly now?: () => number;
}

/** One entry captured for durable delivery -- `payload` is the exact JSON that would go on the wire. */
export interface SyncDiagnosticsOutboxEntry {
  readonly cycleId: string;
  readonly payload: string;
}

/** One outbox row read back as a flush candidate. */
export interface SyncDiagnosticsOutboxRecord {
  readonly cycleId: string;
  readonly payload: string;
  readonly createdAt: number;
}

/**
 * Storage only. It never learns what an HTTP status means -- the same refusal the checkpoint
 * store makes about `SYNC_CYCLE_STAGES`; that vocabulary belongs to the feature layer's flush
 * disposition algorithm.
 */
export interface SyncDiagnosticsOutboxStore {
  /** Durably captures one entry. `DO NOTHING` on a repeated `cycleId` (a rerun), never throws. */
  readonly enqueue: (entry: SyncDiagnosticsOutboxEntry) => void;
  /** Reads up to `limit` undelivered entries, oldest first, eligible as of `now`. */
  readonly readFlushCandidates: (
    limit: number,
    now: number,
  ) => readonly SyncDiagnosticsOutboxRecord[];
  /** Removes one entry by `cycleId` -- delivered, or permanently rejected by the bridge. */
  readonly remove: (cycleId: string) => void;
  /** Persists the not-before timestamp gating the next `readFlushCandidates` call. */
  readonly deferUntil: (notBefore: number) => void;
  /** Counts writes that could not be persisted, so a caller never trusts a silent failure. */
  readonly getFailedWriteCount: () => number;
}
