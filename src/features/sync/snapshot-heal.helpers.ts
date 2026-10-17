import type { SQLiteDatabase } from 'expo-sqlite';
import { resyncFromBridgeSnapshot } from './full-resync.helpers';
import {
  LAST_SUCCESSFUL_SNAPSHOT_HEAL_AT,
  SNAPSHOT_HEAL_STALE_AFTER_MS,
} from './snapshot-heal.constants';
import type { SnapshotHealDemand } from './snapshot-heal.types';

/** Whether `demand` asks for a heal now, given when the last one succeeded. */
function isSnapshotHealDue(demand: SnapshotHealDemand, lastSuccessAt: number | undefined, now: number): boolean {
  if (demand === 'always') {
    return true;
  }

  if (demand === 'never') {
    return false;
  }

  return lastSuccessAt === undefined || now - lastSuccessAt > SNAPSHOT_HEAL_STALE_AFTER_MS;
}

/**
 * Runs the full-snapshot heal (`resyncFromBridgeSnapshot`) when the dispatched cycle's demand asks
 * for it (ADR 009 R-7), and records when it succeeded; a failed heal leaves the previous success in
 * place, so it never resets the reconnect interval. Best effort: it never throws, and a failure is
 * reported as `resync_failed` because this heal has no cycle post-mortem of its own.
 */
export async function healSnapshotOnDemand(
  rawDb: SQLiteDatabase,
  demand: SnapshotHealDemand,
  now: () => number = Date.now,
): Promise<void> {
  if (!isSnapshotHealDue(demand, LAST_SUCCESSFUL_SNAPSHOT_HEAL_AT.get(rawDb), now())) {
    return;
  }

  try {
    await resyncFromBridgeSnapshot(rawDb);
    LAST_SUCCESSFUL_SNAPSHOT_HEAL_AT.set(rawDb, now());
  } catch (error: unknown) {
    console.warn('[useForegroundResync] Resync failed', error);
  }
}
