import type { SQLiteDatabase } from 'expo-sqlite';
import { bridgeClient } from '../../../src/infrastructure/api';
import { getBridgeConfigSnapshot } from '../../../src/infrastructure/db/client/client.helpers';
import { ATTEMPT_PROBE_DEADLINE_MS } from '../../../src/features/sync/attempt-policy.constants';
import { createAttemptPolicy } from '../../../src/features/sync/attempt-policy.helpers';
import { createForegroundSyncRunner } from '../../../src/features/sync/foreground-sync-runner.helpers';
import { runHeadlessSyncCycle } from '../../../src/features/sync/headless-sync-cycle.helpers';
import { createNativeSyncEngine } from '../../../src/features/sync/native-sync-engine/native-sync-engine.helpers';
import { withExclusiveSyncCycle } from '../../../src/features/sync/sync-cycle-lock.helpers';
import { createSyncSQLiteRuntime } from '../../../src/features/sync/sqlite-sync-runtime.helpers';
import { recordSyncAttemptFailed } from '../../../src/features/sync/sync-runtime-status.helpers';
import { SchemaNotReadyError } from '../../../src/infrastructure/db/startup/startup.errors';
import { prepareForegroundDatabase } from '../../../src/infrastructure/db/startup/startup.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import {
  applyMigrationFiles,
  createTestSqliteAdapter,
} from '../../support/sqlite-adapter.helpers';
import {
  buildAnimeRow,
  buildAppliedOperation,
  buildReconcileResponseBody,
} from '../../support/sync-fixtures.helpers';

/** The app database adapter the mocked `getOpenDatabaseSync` hands to every real open path. */
let mockAppDatabaseAdapter: SQLiteDatabase | null = null;

// The ONLY production modules mocked in this suite, both at native boundaries that do not exist
// under node: the expo SQLite runtime is repointed at the in-memory node:sqlite adapter (same
// seam every behaviour suite uses), and the local native sync engine reports `unavailable` so
// the runner's cycle takes the JS path exactly as it does on a device without the engine.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => {
    if (!mockAppDatabaseAdapter) {
      throw new Error('foreground-attempt-gate: harness adapter was not installed before an open path ran');
    }

    return mockAppDatabaseAdapter;
  },
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

jest.mock('../../../src/features/sync/native-sync-engine/native-sync-engine.helpers', () => ({
  createNativeSyncEngine: () => ({
    isAvailable: () => false,
    runOnce: async () => ({ outcome: 'unavailable' as const }),
  }),
}));

/** One `operation_log` row as read back from the real database. */
interface StoredOperationRow {
  anime_id: string;
  status: string;
}

/** The singleton `sync_runtime_status` projection, read back to observe attempts. */
interface StoredRuntimeStatusRow {
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_trigger_source: string | null;
}

/**
 * Builds the controllable tick source the runner subscribes to. The production ticker is a local
 * Expo native module that cannot exist under node, so the harness supplies the same JS seam
 * (`ForegroundSyncTicker`) and drives ticks explicitly.
 */
function createTestTicker() {
  let listener: (() => void | Promise<void>) | null = null;
  let running = false;

  return {
    start: (_intervalMs: number) => {
      running = true;
    },
    stop: () => {
      running = false;
    },
    onTick: (callback: () => void | Promise<void>) => {
      listener = callback;

      return () => {
        listener = null;
      };
    },
    isRunning: () => running,
    /** Dispatches one tick and returns the promise the runner scopes its wake lock to. */
    tick: (): Promise<void> => {
      if (!listener) {
        throw new Error('foreground-attempt-gate: no tick listener registered; start the runner');
      }

      return Promise.resolve(listener());
    },
  };
}

/**
 * Mirrors the production presence probe in `notifee-foreground-service-adapter.helpers.ts`:
 * reads the persisted bridge coordinates through the real snapshot reader and asks the bridge's
 * side-effect-free `GET /api/status` with the real 1500 ms budget through the real bridgeClient
 * singleton. Any HTTP answer (including 401) is presence; transport failure or a missing or
 * incomplete config is absence. Never throws: the gate decides, not the probe.
 */
async function probeBridgePresence(runtime: ReturnType<typeof createSyncSQLiteRuntime>) {
  try {
    const rawDb = await runtime.open();
    const config = await getBridgeConfigSnapshot(rawDb);

    if (!config?.ip || !config.port || !config.token) {
      return false;
    }

    await bridgeClient.getStatus(
      { ip: config.ip, port: config.port, token: config.token },
      { timeoutMs: ATTEMPT_PROBE_DEADLINE_MS },
    );

    return true;
  } catch {
    return false;
  }
}

/** Lets pending promise branches run to their next await point across many awaited steps. */
async function settleBranches(rounds = 25): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * Harness wiring that mirrors the production foreground service: the real runner, the real
 * attempt policy (controllable clock, neutral jitter), and the real JS cycle path the adapter
 * gives the runner (engine-first routing, exclusive cycle lock, headless cycle) over the real
 * in-memory database and the faked wire.
 */
async function createAttemptGateHarness(options: { paired: boolean }) {
  const adapter: SQLiteDatabase = createTestSqliteAdapter();
  mockAppDatabaseAdapter = adapter;

  // The database is prepared exactly as the app prepares it on the device: shipped migration SQL
  // first, then the real foreground startup pipeline (repairs, validation, readiness stamp).
  // Without the stamp the real headless readiness check refuses every cycle with
  // SchemaNotReadyError -- which would silently defeat the suite.
  await applyMigrationFiles(adapter);
  await prepareForegroundDatabase(adapter);

  if (options.paired) {
    await adapter.runAsync(
      'INSERT INTO bridge_config (id, ip, port, token, device_id, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)',
      '192.168.0.10',
      8080,
      'token-1',
      'device-1',
      0,
    );
  }

  const anime = buildAnimeRow();
  const pendingAnimeId = anime._id;
  await adapter.runAsync(
    'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez) VALUES (?, ?, ?, ?, ?, ?)',
    anime._id,
    anime.nombre,
    anime.estado,
    anime.nrocapvisto,
    anime.activo,
    anime.primeravez,
  );
  await adapter.runAsync(
    'INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES (?, ?, ?, ?, ?)',
    anime._id,
    'update',
    JSON.stringify({ episodesWatched: 4, lastWatchedAt: 1_700_000_000_000 }),
    'pending',
    // Recent on purpose: the real headless cycle prunes terminal rows past their TTL, so an
    // ancient created_at would delete the synced row the assertions read back.
    Date.now(),
  );

  const runtime = createSyncSQLiteRuntime({ owner: 'foreground_service' });

  let clockMs = 0;
  const attemptPolicy = createAttemptPolicy({
    probePresence: () => probeBridgePresence(runtime),
    now: () => clockMs,
    // Neutral jitter: 0.5 maps to the exact 1.0 factor, so every backoff wait is deterministic.
    random: () => 0.5,
  });

  const ticker = createTestTicker();
  const runner = createForegroundSyncRunner({
    ticker,
    attemptPolicy,
    onCycleError: async (error) => {
      const message = error instanceof Error ? error.message : 'Foreground sync cycle failed';
      await recordSyncAttemptFailed(adapter, 'foreground_service', Date.now(), message);
    },
    // The real cycle the runner is given in production (see
    // notifee-foreground-service-adapter.helpers.ts): native engine first, then the JS fallback
    // of exclusive-cycle-lock + headless sync cycle over the sync-owned runtime.
    runCycle: async () => {
      const engine = createNativeSyncEngine();

      if (engine.isAvailable()) {
        const engineResult = await engine.runOnce('foreground_service');

        if (engineResult.outcome !== 'unavailable') {
          return;
        }
      }

      const rawDb = await runtime.open();

      try {
        await withExclusiveSyncCycle({
          rawDb,
          owner: 'foreground_service',
          run: async () => {
            await runHeadlessSyncCycle({ runtime, triggerSource: 'foreground_service' });
          },
        });
      } catch (error) {
        if (error instanceof SchemaNotReadyError) {
          return;
        }

        throw error;
      }
    },
  });

  // The runner start promise resolves only when the runner stops; the harness never stops it, so
  // it is deliberately not awaited (mirrors the adapter's fire-and-forget start).
  void runner.start();

  return {
    adapter,
    /** The seeded pending operation's anime id, for reading rows back by identity. */
    pendingAnimeId,
    /** Dispatches one tick through the real runner and waits for its promise to settle. */
    tick: async () => {
      await ticker.tick();
    },
    /** Dispatches one tick without waiting, to observe the promise the caller would hold. */
    tickUnawaited: () => ticker.tick(),
    advanceClockTo: (ms: number) => {
      clockMs = ms;
    },
    clockNow: () => clockMs,
  };
}

/** Queues one full approved attempt: probe 401 (present), diagnostics flush 200, reconcile 202. */
function queueApprovedAttemptResponses(fakeBridge: FakeBridge, animeId: string) {
  fakeBridge.queueResponse({ status: 401, body: { error: 'unauthorized' } });
  queueCycleResponses(fakeBridge, animeId);
}

/** Queues the cycle responses only: diagnostics flush 200, reconcile 202 confirming the op. */
function queueCycleResponses(fakeBridge: FakeBridge, animeId: string) {
  fakeBridge.queueResponse({ status: 200, body: {} });
  queueReconcileConfirmation(fakeBridge, animeId);
}

/** Queues only the reconcile 202 that confirms the seeded pending operation as synced. */
function queueReconcileConfirmation(fakeBridge: FakeBridge, animeId: string) {
  fakeBridge.queueResponse({
    status: 202,
    body: buildReconcileResponseBody({
      appliedOperations: [buildAppliedOperation({ anime_id: animeId, operation: 'update' })],
      lastChangelogId: 41,
    }),
  });
}

/** Counts the presence probes (`GET /api/status`) the fake bridge saw. */
function countProbes(fakeBridge: FakeBridge): number {
  return fakeBridge.requests.filter(
    (request) => request.method === 'GET' && request.url.includes('/api/status'),
  ).length;
}

/** Counts the reconcile posts (`POST .../reconcile`) the fake bridge saw. */
function countReconcilePosts(fakeBridge: FakeBridge): number {
  return fakeBridge.requests.filter(
    (request) => request.method === 'POST' && request.url.includes('/reconcile'),
  ).length;
}

/** Reads every `operation_log` row back from the real database, in insertion order. */
async function readOperationRows(adapter: SQLiteDatabase): Promise<StoredOperationRow[]> {
  return adapter.getAllAsync<StoredOperationRow>(
    'SELECT anime_id, status FROM operation_log ORDER BY id',
  );
}

/** Reads the singleton `sync_runtime_status` projection, or null before the first attempt. */
async function readRuntimeStatus(adapter: SQLiteDatabase): Promise<StoredRuntimeStatusRow | null> {
  return adapter.getFirstAsync<StoredRuntimeStatusRow>(
    'SELECT last_attempt_at, last_success_at, last_trigger_source FROM sync_runtime_status',
  );
}

describe('foreground sync attempt gate against a real runner, policy and database', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
    mockAppDatabaseAdapter = null;
  });

  it('refuses the tick when the bridge is unreachable: no cycle, no writes, promise settles', async () => {
    // Nothing queued: every request the probe makes meets a transport failure, the exact
    // "absent bridge" the device evidence measured (journal stopped growing entirely).
    const harness = await createAttemptGateHarness({ paired: true });

    await expect(harness.tick()).resolves.toBeUndefined();

    // The probe went out and got no answer, so exactly one probe and no reconcile hit the wire.
    expect(countProbes(fakeBridge)).toBe(1);
    expect(countReconcilePosts(fakeBridge)).toBe(0);

    // The durable footprint proves the refusal: the operation is still pending and no attempt
    // was recorded in the runtime status the Settings tile reads.
    expect(await readOperationRows(harness.adapter)).toEqual([
      { anime_id: expect.any(String), status: 'pending' },
    ]);
    const status = await readRuntimeStatus(harness.adapter);
    expect(status?.last_attempt_at ?? null).toBeNull();
    expect(status?.last_trigger_source ?? null).toBeNull();
  });

  it('refuses the tick without touching the wire when the bridge config is missing', async () => {
    const harness = await createAttemptGateHarness({ paired: false });

    await expect(harness.tick()).resolves.toBeUndefined();

    // An unpaired app must not even spend the probe budget: absence is decided from the config.
    expect(fakeBridge.requests).toHaveLength(0);
    expect(countReconcilePosts(fakeBridge)).toBe(0);
    expect(await readOperationRows(harness.adapter)).toEqual([
      { anime_id: harness.pendingAnimeId, status: 'pending' },
    ]);
  });

  it('runs the cycle when the probe reaches a bridge that answers 401', async () => {
    const harness = await createAttemptGateHarness({ paired: true });
    queueApprovedAttemptResponses(fakeBridge, harness.pendingAnimeId);

    await expect(harness.tick()).resolves.toBeUndefined();

    // Presence was proven by the probe reaching the bridge (any HTTP status counts, 401
    // included), and the approved cycle then ran for real: the reconcile round trip left its
    // durable footprint.
    expect(countProbes(fakeBridge)).toBe(1);
    expect(countReconcilePosts(fakeBridge)).toBe(1);
    expect(await readOperationRows(harness.adapter)).toEqual([
      { anime_id: harness.pendingAnimeId, status: 'synced' },
    ]);

    const status = await readRuntimeStatus(harness.adapter);
    expect(status?.last_trigger_source ?? null).toBe('foreground_service');
    expect(status?.last_attempt_at ?? null).not.toBeNull();
    expect(status?.last_success_at ?? null).not.toBeNull();
  });

  it('refuses a second tick while the first attempt is still probing the bridge', async () => {
    const harness = await createAttemptGateHarness({ paired: true });

    // Hold the probe in flight: the first tick's attempt is now pending.
    const deferredProbe = fakeBridge.queueDeferredResponse();
    const firstTick = harness.tickUnawaited();

    // Let the first tick reach the in-flight probe before the second tick arrives.
    await settleBranches();
    expect(countProbes(fakeBridge)).toBe(1);

    // The second tick must be refused, not piled up: it settles immediately and never starts a
    // second probe.
    await expect(harness.tick()).resolves.toBeUndefined();
    expect(countProbes(fakeBridge)).toBe(1);

    // Releasing the held probe approves the first attempt, whose cycle then runs to completion
    // on the responses queued for it -- the refusal must not have disturbed the first attempt.
    deferredProbe.release({ status: 401, body: {} });
    queueCycleResponses(fakeBridge, harness.pendingAnimeId);
    await firstTick;

    expect(countReconcilePosts(fakeBridge)).toBe(1);
    expect(await readOperationRows(harness.adapter)).toEqual([
      { anime_id: harness.pendingAnimeId, status: 'synced' },
    ]);
  });

  it('refuses a second tick while the first attempt is mid-cycle', async () => {
    const harness = await createAttemptGateHarness({ paired: true });

    // Probe answers immediately (present), but the cycle's first wire call hangs: the first
    // attempt is mid-cycle and its outcome is not yet reported to the policy.
    fakeBridge.queueResponse({ status: 401, body: {} });
    const deferredCycleCall = fakeBridge.queueDeferredResponse();

    const firstTick = harness.tickUnawaited();

    await settleBranches();
    expect(countProbes(fakeBridge)).toBe(1);

    await expect(harness.tick()).resolves.toBeUndefined();

    // No second attempt started: still one probe, and the mid-cycle call is the only other
    // request on the wire.
    expect(countProbes(fakeBridge)).toBe(1);
    expect(fakeBridge.requests).toHaveLength(2);

    // The held cycle completes normally once released: the held call is the cycle's diagnostics
    // flush POST (it precedes the reconcile on the wire), so releasing it with a 200 and then
    // queueing the reconcile confirmation lets the first attempt finish cleanly. The refusal
    // must not have disturbed it.
    deferredCycleCall.release({ status: 200, body: {} });
    queueReconcileConfirmation(fakeBridge, harness.pendingAnimeId);
    await firstTick;

    expect(countReconcilePosts(fakeBridge)).toBe(1);
    expect(await readOperationRows(harness.adapter)).toEqual([
      { anime_id: harness.pendingAnimeId, status: 'synced' },
    ]);
  });

  it('pushes the next attempt out after an absent bridge and resets the ladder on success', async () => {
    const harness = await createAttemptGateHarness({ paired: true });

    // T0: the bridge is absent. The failure schedules the next attempt one base interval out.
    await harness.tick();
    expect(countProbes(fakeBridge)).toBe(1);

    // T+1s: still inside the backoff window -- the tick is refused before probing again.
    harness.advanceClockTo(harness.clockNow() + 1_000);
    await harness.tick();
    expect(countProbes(fakeBridge)).toBe(1);
    expect(countReconcilePosts(fakeBridge)).toBe(0);

    // T+60s (one 60 s base interval): the probe is allowed again. The bridge now answers 401,
    // the cycle runs, and the success resets the ladder to the shortest wait.
    harness.advanceClockTo(harness.clockNow() + 59_000);
    queueApprovedAttemptResponses(fakeBridge, harness.pendingAnimeId);
    await harness.tick();

    expect(countProbes(fakeBridge)).toBe(2);
    expect(countReconcilePosts(fakeBridge)).toBe(1);
    expect(await readOperationRows(harness.adapter)).toEqual([
      { anime_id: harness.pendingAnimeId, status: 'synced' },
    ]);
  });

  it('never lengthens the ladder while the bridge answers the probe with 4xx', async () => {
    const harness = await createAttemptGateHarness({ paired: true });

    // Two consecutive ticks whose probes are answered with 401: both must approve a cycle. A
    // 4xx answer is presence -- per-operation rejection is dead_letter's business, not the
    // cadence's -- so the second tick must not be pushed into a backoff window.
    queueApprovedAttemptResponses(fakeBridge, harness.pendingAnimeId);
    await harness.tick();
    queueApprovedAttemptResponses(fakeBridge, harness.pendingAnimeId);
    await harness.tick();

    expect(countProbes(fakeBridge)).toBe(2);
    expect(countReconcilePosts(fakeBridge)).toBe(2);

    // The ladder is still at its shortest step: the next absent-bridge failure schedules the
    // next attempt one base interval out, exactly like the first failure ever would.
    await harness.tick();
    expect(countProbes(fakeBridge)).toBe(3);

    harness.advanceClockTo(harness.clockNow() + 1_000);
    await harness.tick();
    expect(countProbes(fakeBridge)).toBe(3);

    harness.advanceClockTo(harness.clockNow() + 59_000);
    await harness.tick();
    expect(countProbes(fakeBridge)).toBe(4);
  });
});
