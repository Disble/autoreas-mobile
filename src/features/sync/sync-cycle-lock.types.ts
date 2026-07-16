import type { SQLiteDatabase } from 'expo-sqlite';

/** Defines the data contract for with exclusive sync cycle params. */
export interface WithExclusiveSyncCycleParams {
  readonly rawDb: SQLiteDatabase;
  readonly owner: string;
  readonly run: () => Promise<void>;
  readonly leaseMs?: number;
  readonly now?: () => number;
}
