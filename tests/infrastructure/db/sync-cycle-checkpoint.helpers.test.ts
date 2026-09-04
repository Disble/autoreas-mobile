import type { SQLiteDatabase } from 'expo-sqlite';
import {
  createSyncCycleCheckpointStore,
  SYNC_CYCLE_CHECKPOINT_BUSY_TIMEOUT_MS,
  SYNC_CYCLE_CHECKPOINT_DATABASE_NAME,
} from '../../../src/infrastructure/db/sync-cycle-checkpoint';
import { DATABASE_NAME } from '../../../src/infrastructure/db/client';
import { createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

describe('sync cycle checkpoint store', () => {
  /** Opens one real in-memory database and records how it was asked for. */
  function buildOpener() {
    const calls: unknown[] = [];
    const adapter = createTestSqliteAdapter();

    return {
      adapter,
      calls,
      open: (options?: unknown) => {
        calls.push(options);
        return adapter;
      },
    };
  }

  function readRow(adapter: SQLiteDatabase) {
    return adapter.getFirstAsync<{
      cycle_id: string;
      stage: string;
      stage_at: number;
      started_at: number;
      failed_checkpoint_count: number;
    }>('SELECT * FROM sync_cycle_checkpoint WHERE id = 1');
  }

  it('opens its OWN database file, never the app database', async () => {
    // This is the whole point of the design. The app file's write door is keyed by path
    // (client.helpers.ts:288), so a checkpoint on the app file queues behind the very hang it is
    // trying to report and never lands.
    const opener = buildOpener();

    createSyncCycleCheckpointStore({
      cycleId: 'cycle-1',
      startedAt: 1_000,
      openDatabase: opener.open,
    }).record('open');

    // Asserted against the LITERAL name, not against the constant. Comparing the constant to
    // itself is a tautology that stays green even if the constant is repointed at the app
    // database -- which is the single change that would defeat this entire design.
    expect(opener.calls).toHaveLength(1);
    expect(opener.calls[0]).toMatchObject({
      databaseName: 'autoreas-telemetry.db',
      useNewConnection: true,
      enableChangeListener: false,
      busyTimeoutMs: 250,
    });
    expect(SYNC_CYCLE_CHECKPOINT_DATABASE_NAME).not.toBe(DATABASE_NAME);
    expect(SYNC_CYCLE_CHECKPOINT_BUSY_TIMEOUT_MS).toBeLessThan(1_000);
  });

  it('persists the stage, its timestamp and the cycle id', async () => {
    const opener = buildOpener();
    const store = createSyncCycleCheckpointStore({
      cycleId: 'cycle-1',
      startedAt: 1_000,
      openDatabase: opener.open,
      now: () => 1_250,
    });

    store.record('apply_write');

    await expect(readRow(opener.adapter)).resolves.toMatchObject({
      cycle_id: 'cycle-1',
      stage: 'apply_write',
      stage_at: 1_250,
      started_at: 1_000,
    });
  });

  it('advances the stage as the cycle progresses', async () => {
    const opener = buildOpener();
    let clock = 1_000;
    const store = createSyncCycleCheckpointStore({
      cycleId: 'cycle-1',
      startedAt: 1_000,
      openDatabase: opener.open,
      now: () => (clock += 10),
    });

    store.record('open');
    store.record('http');
    store.record('apply_write');

    await expect(readRow(opener.adapter)).resolves.toMatchObject({
      stage: 'apply_write',
      stage_at: 1_030,
    });
  });

  it('never regresses to an earlier checkpoint of the same cycle', async () => {
    // Two overlapping cycles share this file. A late write from a slower path must not roll the
    // reported stage backwards, or the report names a step the cycle already left.
    const opener = buildOpener();
    let stamp = 5_000;
    const store = createSyncCycleCheckpointStore({
      cycleId: 'cycle-1',
      startedAt: 1_000,
      openDatabase: opener.open,
      now: () => stamp,
    });

    store.record('apply_write');
    stamp = 4_000;
    store.record('http');

    await expect(readRow(opener.adapter)).resolves.toMatchObject({
      stage: 'apply_write',
      stage_at: 5_000,
    });
  });

  it('lets a NEW cycle take the row over even with a stale clock', async () => {
    const opener = buildOpener();

    createSyncCycleCheckpointStore({
      cycleId: 'cycle-1',
      startedAt: 1_000,
      openDatabase: opener.open,
      now: () => 9_000,
    }).record('apply_write');

    createSyncCycleCheckpointStore({
      cycleId: 'cycle-2',
      startedAt: 2_000,
      openDatabase: opener.open,
      now: () => 100,
    }).record('open');

    await expect(readRow(opener.adapter)).resolves.toMatchObject({
      cycle_id: 'cycle-2',
      stage: 'open',
    });
  });

  it('never throws when the checkpoint write fails, and counts the failure', () => {
    // Instrumentation that can fail the cycle is worse than no instrumentation.
    const store = createSyncCycleCheckpointStore({
      cycleId: 'cycle-1',
      startedAt: 1_000,
      openDatabase: () => {
        throw new Error('telemetry database unavailable');
      },
    });

    expect(() => store.record('http')).not.toThrow();
    expect(store.getFailedCheckpointCount()).toBe(1);
  });

  it('carries the accumulated failure count into the next checkpoint that does land', async () => {
    // A silent failure leaves a STALE stage behind. Without this count, "died at X" and "the
    // checkpoint for Y could not be written" are the same reading.
    const opener = buildOpener();
    let failing = true;
    const store = createSyncCycleCheckpointStore({
      cycleId: 'cycle-1',
      startedAt: 1_000,
      openDatabase: (options?: unknown) => {
        if (failing) {
          throw new Error('unavailable');
        }

        return opener.open(options);
      },
      now: () => 1_100,
    });

    store.record('http');
    store.record('parse_response');
    failing = false;
    store.record('apply_write');

    expect(store.getFailedCheckpointCount()).toBe(2);
    await expect(readRow(opener.adapter)).resolves.toMatchObject({
      stage: 'apply_write',
      failed_checkpoint_count: 2,
    });
  });

  it('reads back the last checkpoint so the NEXT cycle can report where this one died', async () => {
    const opener = buildOpener();

    createSyncCycleCheckpointStore({
      cycleId: 'cycle-1',
      startedAt: 1_000,
      openDatabase: opener.open,
      now: () => 1_400,
    }).record('apply_write');

    const next = createSyncCycleCheckpointStore({
      cycleId: 'cycle-2',
      startedAt: 9_000,
      openDatabase: opener.open,
    });

    await expect(next.readLastCheckpoint()).resolves.toEqual({
      cycleId: 'cycle-1',
      stage: 'apply_write',
      stageAt: 1_400,
      startedAt: 1_000,
      failedCheckpointCount: 0,
      elapsedMs: 400,
    });
  });

  it('reports no previous checkpoint instead of throwing on a fresh install', async () => {
    const opener = buildOpener();
    const store = createSyncCycleCheckpointStore({
      cycleId: 'cycle-1',
      startedAt: 1_000,
      openDatabase: opener.open,
    });

    await expect(store.readLastCheckpoint()).resolves.toBeNull();
  });

  it('returns null rather than throwing when the telemetry database cannot be opened', async () => {
    const store = createSyncCycleCheckpointStore({
      cycleId: 'cycle-1',
      startedAt: 1_000,
      openDatabase: () => {
        throw new Error('unavailable');
      },
    });

    await expect(store.readLastCheckpoint()).resolves.toBeNull();
  });
});
