import type { SQLiteDatabase } from 'expo-sqlite';

/** Row shape of a diagnostics outbox candidate, exactly as SQLite returns it. */
export interface SyncDiagnosticsOutboxRow {
  readonly cycle_id: string;
  readonly payload: string;
  readonly created_at: number;
}

/** Row shape of the singleton shed counter, exactly as SQLite returns it. */
export interface SyncDiagnosticsOutboxShedCountRow {
  readonly shed_rows: number;
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
 * Outcome of one outbox write attempt. `'removed'` means the DELETE executed without throwing --
 * deliberately not gated on `changes > 0`, since a row already absent is still absent, which is
 * the invariant callers need. `'failed'` means it threw; the row remains queued.
 */
export type SyncDiagnosticsOutboxWriteOutcome = 'removed' | 'failed';

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
  /**
   * Removes one entry by `cycleId` -- delivered, or permanently rejected by the bridge. Never
   * throws; returns the outcome instead so a caller can tell a confirmed delete from a failed one.
   */
  readonly remove: (cycleId: string) => SyncDiagnosticsOutboxWriteOutcome;
  /** Persists the not-before timestamp gating the next `readFlushCandidates` call. */
  readonly deferUntil: (notBefore: number) => void;
  /** Counts writes that could not be persisted, so a caller never trusts a silent failure. */
  readonly getFailedWriteCount: () => number;
  /**
   * The cumulative number of rows the cap trigger has shed for capacity -- the bounded loss the
   * policy accepts, reported as its own fact instead of remaining an unrecorded absence.
   *
   * A STORE fact, not a flush outcome: the shed is caused by an INSERT hitting the cap, which can
   * happen outside any flush pass, so folding it into a flush result would report it late, or not
   * at all. Counted in the same transaction that drops the rows, persisted in the outbox's own
   * file, so it survives a restart and every store instance on that file agrees on it. Never
   * throws: an unreadable counter reads as `0`, since instrumentation must never fail a cycle.
   */
  readonly getShedCount: () => number;
  /**
   * The same cumulative total as `getShedCount`, but HONEST about a failed read: `null` when the
   * counter could not be read, `0` only when it was read and no row has ever been shed.
   *
   * Exists BESIDE `getShedCount` rather than replacing it: that method's never-throws/reads-as-0
   * contract has callers that legitimately want "no evidence of a shed" and must keep working
   * unchanged. A status surface is the opposite caller -- it must render an unreadable counter as
   * ABSENT, and a fabricated `0` there would state a measurement that was never taken.
   */
  readonly readShedCount: () => number | null;
}
