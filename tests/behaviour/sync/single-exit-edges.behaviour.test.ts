import type { SQLiteDatabase } from 'expo-sqlite';
import * as chapterActionDiagnostics from '../../../src/features/animes/chapter-action-diagnostics.helpers';
import { applyAnimeMutationPatch, buildCapPlusPatch } from '../../../src/features/animes/anime-mutation.helpers';
import { enqueueSeasonRatingIntent } from '../../../src/features/sync/season-rating-intent.helpers';
import { getSyncConnectionSnapshot, resetSyncConnectionStore } from '../../../src/features/sync/sync-connection-store';
import { dispatchForegroundSyncFlush } from '../../../src/features/sync/sync-facade.helpers';
import {
  registerSyncFlushDispatcher,
  requestFlush,
  resetSyncFlush,
  waitForSyncFlushIdle,
} from '../../../src/features/sync/sync-flush.helpers';
import type { SyncFlushRequest } from '../../../src/features/sync/sync-flush.types';
import { runMigrations } from '../../../src/infrastructure/db/client';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { confirmedAt, openPairedDatabase, readOperationRows, readRatingRows } from './unresolved-fixtures.helpers';

// Same seam as `single-exit.behaviour.test.ts`: only the drizzle factory is swapped.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

// Fire-and-forget image work, not an outbound kind: stubbed so the response queue is about the sends.
jest.mock('../../../src/features/sync/cover-sweep/cover-sweep.helpers', () => ({
  runCoverSweep: jest.fn().mockResolvedValue(undefined),
}));

/** A reconcile answer that confirms nothing and pulls nothing. */
const EMPTY_RECONCILE = {
  status: 202,
  body: { status: 'ok', applied_operations: [], bridge_changes: [], last_changelog_id: 0 },
};

/** A failing answer to the pull a delivered rating owes. */
const PULL_DOWN = { status: 500, body: { error: 'changelog unavailable' } };

/** One run of a hand-settled dispatcher, with the request it received. */
interface DeferredRun {
  readonly request: SyncFlushRequest;
  readonly resolve: (syncedCount: number) => void;
}

/** Opens the paired fixture database with one queued edit per entry of `episodes`, repaired. */
async function openRepairedDatabase(episodes: readonly number[] = []): Promise<SQLiteDatabase> {
  const adapter = await openPairedDatabase({ episodes });
  await runMigrations(adapter);

  return adapter;
}

/** The request urls the fake bridge saw, without host, in arrival order. */
function sentPaths(fakeBridge: FakeBridge): string[] {
  return fakeBridge.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`);
}

/** A dispatcher whose runs the test settles by hand, recording the peak overlap. */
function deferredDispatcher() {
  const runs: DeferredRun[] = [];
  let active = 0;
  let maxActive = 0;
  const dispatcher = (request: SyncFlushRequest) =>
    new Promise<number>((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      runs.push({
        request,
        resolve: (syncedCount) => {
          active -= 1;
          resolve(syncedCount);
        },
      });
    });

  return { dispatcher, runs, maxActive: () => maxActive };
}

/** Lets queued microtasks (a run's settle and its follow-up start) drain. */
async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

/** Waits, on real timers, until the fake bridge has seen `count` requests. */
async function waitForRequests(fakeBridge: FakeBridge, count: number): Promise<void> {
  for (let attempt = 0; attempt < 50 && fakeBridge.requests.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('single-exit edges (ADR 009 R-2, T11 verifier probes)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
    resetSyncConnectionStore();
    resetSyncFlush();
  });

  afterEach(() => {
    resetSyncFlush();
    fakeBridge.restore();
    jest.restoreAllMocks();
  });

  it('V1: N concurrent requests run one cycle plus exactly one follow-up, never overlapping', async () => {
    const adapter = await openRepairedDatabase();
    const probe = deferredDispatcher();
    registerSyncFlushDispatcher(probe.dispatcher);

    const results = Array.from({ length: 6 }, (_, index) => requestFlush(adapter, index === 0 ? 'manual' : 'app_active'));
    expect(probe.runs).toHaveLength(1);
    probe.runs[0].resolve(1);
    await flushMicrotasks();
    expect(probe.runs).toHaveLength(2);
    probe.runs[1].resolve(2);

    await expect(Promise.all(results)).resolves.toEqual([1, 2, 2, 2, 2, 2]);
    expect(probe.maxActive()).toBe(1);
    expect(probe.runs.map((run) => run.request.source)).toEqual(['manual', 'app_active']);
  });

  it('V2: a request arriving after the follow-up started schedules another run', async () => {
    const adapter = await openRepairedDatabase();
    const probe = deferredDispatcher();
    registerSyncFlushDispatcher(probe.dispatcher);

    void requestFlush(adapter, 'manual');
    const second = requestFlush(adapter, 'app_active');
    probe.runs[0].resolve(0);
    await flushMicrotasks();
    expect(probe.runs).toHaveLength(2);
    const third = requestFlush(adapter, 'network_regained');
    probe.runs[1].resolve(0);
    await flushMicrotasks();
    expect(probe.runs).toHaveLength(3);
    expect(probe.runs[2].request.source).toBe('network_regained');
    probe.runs[2].resolve(5);

    await expect(second).resolves.toBe(0);
    await expect(third).resolves.toBe(5);
    expect(probe.maxActive()).toBe(1);
  });

  it('V3: a failing running cycle still lets the follow-up run, and the final status is the last cycle', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = await openRepairedDatabase();
    registerSyncFlushDispatcher(dispatchForegroundSyncFlush);
    fakeBridge.queueResponse({ status: 500, body: { error: 'boom' } });
    fakeBridge.queueResponse(EMPTY_RECONCILE);

    const first = requestFlush(adapter, 'manual');
    const second = requestFlush(adapter, 'network_regained');
    const firstOutcome = await first.then(() => 'resolved', () => 'rejected');
    await expect(second).resolves.toBe(0);
    await waitForSyncFlushIdle(adapter);

    expect(firstOutcome).toBe('rejected');
    expect(sentPaths(fakeBridge)).toEqual(['POST /api/sync/reconcile', 'POST /api/sync/reconcile']);
    expect(getSyncConnectionSnapshot().kind).toBe('online');
  });

  it('V4: an edit made while a cycle runs is sent by the follow-up', async () => {
    const adapter = await openRepairedDatabase();
    registerSyncFlushDispatcher(dispatchForegroundSyncFlush);
    const held = fakeBridge.queueDeferredResponse();
    fakeBridge.queueResponse(confirmedAt(8));

    const running = requestFlush(adapter, 'manual');
    await waitForRequests(fakeBridge, 1);
    expect(fakeBridge.requests).toHaveLength(1);
    await expect(applyAnimeMutationPatch(adapter, 'anime-1', buildCapPlusPatch, 'capPlus')).resolves.toBe(true);
    held.release(EMPTY_RECONCILE);
    await running;
    await waitForSyncFlushIdle(adapter);

    expect(sentPaths(fakeBridge)).toEqual(['POST /api/sync/reconcile', 'POST /api/sync/reconcile']);
    expect(await readOperationRows(adapter)).toEqual([expect.objectContaining({ status: 'synced' })]);
    expect(getSyncConnectionSnapshot().kind).toBe('online');
  });

  it('V5: a rating enqueued offline stays pending and leaves on the next flush', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = await openRepairedDatabase();
    registerSyncFlushDispatcher(dispatchForegroundSyncFlush);
    const offline = fakeBridge.queueDeferredResponse();

    await enqueueSeasonRatingIntent(adapter, { seasonId: 'season-1', animeId: 'anime-1', nota: 8, ratedAt: 1_700_000_000_000 });
    await waitForRequests(fakeBridge, 1);
    offline.reject(new TypeError('Network request failed'));
    await waitForSyncFlushIdle(adapter);
    expect(await readRatingRows(adapter)).toEqual([expect.objectContaining({ status: 'pending' })]);
    expect(getSyncConnectionSnapshot().kind).toBe('unreachable');

    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse({ status: 204, body: null });
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    await requestFlush(adapter, 'network_regained');

    expect(await readRatingRows(adapter)).toEqual([expect.objectContaining({ status: 'synced' })]);
    expect(getSyncConnectionSnapshot().kind).toBe('online');
  });

  it('V6: a failed pull after a delivered rating does not fail the cycle that delivered it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = await openRepairedDatabase();
    registerSyncFlushDispatcher(dispatchForegroundSyncFlush);
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse({ status: 204, body: null });
    fakeBridge.queueResponse(PULL_DOWN);

    await enqueueSeasonRatingIntent(adapter, { seasonId: 'season-1', animeId: 'anime-1', nota: 4, ratedAt: 1_700_000_000_000 });
    const outcome = await waitForSyncFlushIdle(adapter).then(() => 'resolved', () => 'rejected');

    expect(sentPaths(fakeBridge)).toEqual([
      'POST /api/sync/reconcile',
      'POST /api/seasons/active/ratings',
      'POST /api/sync/reconcile',
    ]);
    expect(await readRatingRows(adapter)).toEqual([expect.objectContaining({ status: 'synced' })]);
    expect({ outcome, kind: getSyncConnectionSnapshot().kind }).toEqual({ outcome: 'resolved', kind: 'online' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('The pull after a delivered rating failed'), expect.anything());
  });

  it('keeps the chapter push reported as succeeded when its cycle only fails the pull after a delivered rating', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const recordSync = jest.spyOn(chapterActionDiagnostics, 'recordChapterActionSync');
    const adapter = await openRepairedDatabase();
    await adapter.runAsync(
      "INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES ('anime-2', 'season_rating', '{\"seasonId\":\"season-1\",\"grade\":7,\"ratedAt\":1}', 'pending', 1)",
    );
    registerSyncFlushDispatcher(dispatchForegroundSyncFlush);
    fakeBridge.queueResponse(confirmedAt(8));
    fakeBridge.queueResponse({ status: 204, body: null });
    fakeBridge.queueResponse(PULL_DOWN);
    const actionContext = chapterActionDiagnostics.beginChapterAction('capPlus', { isTelemetryEnabled: false });

    await applyAnimeMutationPatch(adapter, 'anime-1', buildCapPlusPatch, 'capPlus', actionContext);
    await waitForSyncFlushIdle(adapter);
    await flushMicrotasks();

    expect(await readOperationRows(adapter)).toEqual([
      expect.objectContaining({ status: 'synced' }),
      expect.objectContaining({ status: 'synced' }),
    ]);
    expect(recordSync).toHaveBeenCalledWith(actionContext, 'ok');
    expect(recordSync).not.toHaveBeenCalledWith(actionContext, 'failed');
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Sync failed'), expect.anything());
    expect(getSyncConnectionSnapshot().kind).toBe('online');
  });

  it('V7: a follow-up left without a dispatcher settles the connection as pending, not syncing', async () => {
    const adapter = await openRepairedDatabase();
    const probe = deferredDispatcher();
    const unregister = registerSyncFlushDispatcher(probe.dispatcher);

    void requestFlush(adapter, 'manual');
    const followUp = requestFlush(adapter, 'app_active');
    unregister();
    probe.runs[0].resolve(0);

    await expect(followUp).resolves.toBe(0);
    expect(getSyncConnectionSnapshot().kind).toBe('idle');
  });
});
