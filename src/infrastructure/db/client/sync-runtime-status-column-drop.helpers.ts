import type { SQLiteDatabase } from 'expo-sqlite';
import {
  DEAD_SYNC_RUNTIME_STATUS_COLUMNS,
  SYNC_RUNTIME_STATUS_TABLE_INFO_SQL,
} from './sync-runtime-status-column-drop.constants';

/**
 * Drops every dead `sync_runtime_status` column an installed device still holds, in ONE exclusive
 * transaction (migration 0020's repair twin). An installed device never runs 0020's `.sql` --
 * `reconcileMigrationLedger` pins the gate -- so this step is its only route.
 *
 * - Idempotent: with no dead column left (a fresh install's 0020 dropped them, or a previous launch
 *   did) it returns before opening a transaction.
 * - All or nothing: any failure rolls every drop back, the row keeps every column, and the error
 *   propagates so readiness is not stamped; the next launch retries the whole drop.
 * - Rows survive: `DROP COLUMN` rewrites the table in place, so the kept columns of the singleton
 *   row are unchanged.
 *
 * It must run after `ensureSyncRuntimeStatusExecutionColumns`, so the kept columns exist whatever
 * the device's history.
 */
export async function dropDeadSyncRuntimeStatusColumns(rawDb: SQLiteDatabase): Promise<void> {
  const columns = await rawDb.getAllAsync<{ name: string }>(SYNC_RUNTIME_STATUS_TABLE_INFO_SQL);
  const present = new Set(columns.map((column) => column.name));
  const dead = DEAD_SYNC_RUNTIME_STATUS_COLUMNS.filter((column) => present.has(column));

  if (dead.length === 0) {
    return;
  }

  // Outside the rollback guard, like `withLocalWrite`: a BEGIN that fails opened nothing to roll back.
  await rawDb.execAsync('BEGIN EXCLUSIVE');

  try {
    // Chained one after another, like `ensureMissingColumns`: each drop rewrites the same table.
    await dead.reduce<Promise<unknown>>(
      (previous, column) =>
        previous.then(() => rawDb.runAsync(`ALTER TABLE sync_runtime_status DROP COLUMN ${column}`)),
      Promise.resolve(),
    );
    await rawDb.execAsync('COMMIT');
  } catch (error) {
    await rawDb.execAsync('ROLLBACK');
    throw error;
  }
}
