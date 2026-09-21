import type { SQLiteDatabase } from 'expo-sqlite';

/** Defines the data contract for with exclusive sync cycle params. */
export interface WithExclusiveSyncCycleParams {
  readonly rawDb: SQLiteDatabase;
  readonly owner: string;
  readonly run: () => Promise<void>;
  readonly leaseMs?: number;
  readonly now?: () => number;
  /**
   * Generates the unique per-claim fence token stored on the lock row. Defaults to
   * `expo-crypto`'s `randomUUID` (platform CSPRNG); injectable so tests can pin a value and
   * assert on the row's stored fence instead of on randomness itself.
   */
  readonly generateFenceToken?: () => string;
}
