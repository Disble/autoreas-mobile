import type { SQLiteDatabase } from 'expo-sqlite';

/** Row shape of the singleton checkpoint row, exactly as SQLite returns it. */
export interface SyncCycleCheckpointRow {
  readonly cycle_id: string;
  readonly stage: string;
  readonly stage_at: number;
  readonly started_at: number;
  readonly failed_checkpoint_count: number;
}

/** Options the checkpoint store passes to its own opener; mirrors the app opener's shape. */
export interface OpenCheckpointDatabaseParams {
  readonly databaseName: string;
  readonly useNewConnection: boolean;
  readonly enableChangeListener: boolean;
  readonly busyTimeoutMs: number;
}

/** Defines the dependencies for one cycle's checkpoint store. */
export interface SyncCycleCheckpointStoreParams {
  readonly cycleId: string;
  readonly startedAt: number;
  readonly openDatabase?: (options: OpenCheckpointDatabaseParams) => SQLiteDatabase;
  readonly now?: () => number;
}

/**
 * The checkpoint a PREVIOUS cycle left behind.
 *
 * `elapsedMs` is `stageAt - startedAt`: a duration actually measured inside the cycle. Deriving it
 * at read time as `now - startedAt` instead would fold in the whole gap until the scheduler fired
 * the next cycle, which measures how long ago the cycle began rather than how long it ran.
 */
export interface SyncCycleCheckpointSnapshot {
  readonly cycleId: string;
  readonly stage: string;
  readonly stageAt: number;
  readonly startedAt: number;
  readonly failedCheckpointCount: number;
  readonly elapsedMs: number;
}

/** Records where one cycle is, on storage that shares no failure domain with the cycle. */
export interface SyncCycleCheckpointStore {
  /**
   * Marks the cycle as HAVING ENTERED `stage`. Call it before awaiting the step, never after:
   * written on completion the field would mean "the last step that finished", and a hang in
   * `claim_ops` would report `backlog_read` and send the reader to code that worked.
   *
   * Synchronous, and never throws. `stage` is an opaque label here: the closed vocabulary
   * (`SYNC_CYCLE_STAGES`) belongs to the feature layer, which this layer must not import.
   */
  readonly record: (stage: string) => void;
  /** Counts checkpoints that could not be written, so a stale stage is never read as fresh. */
  readonly getFailedCheckpointCount: () => number;
  /** Reads the checkpoint left by the previous cycle, or `null` when there is none. */
  readonly readLastCheckpoint: () => Promise<SyncCycleCheckpointSnapshot | null>;
}
