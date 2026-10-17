import type { SQLiteDatabase } from 'expo-sqlite';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { drainSeasonRatingQueue } from '../../../src/features/sync/season-rating-queue.helpers';
import {
  answeredContractRequests,
  loadContractFixtures,
  openContractDatabase,
  queueContractCycle,
  readContractState,
} from '../../support/contract-fixture.helpers';
import type { ContractAttemptOutcome, ContractFixture, ContractRequest } from '../../support/contract-fixture.types';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';

// Same seam as `per-message-failure.behaviour.test.ts`: only the drizzle factory is swapped.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** Every shared fixture, read once at collection time so each one becomes its own test. */
const fixtures = loadContractFixtures();

/** Runs one attempt of the queue the fixture is about and reports how it ended. */
function runAttempt(adapter: SQLiteDatabase, fixture: ContractFixture): Promise<ContractAttemptOutcome> {
  const attempt = fixture.kind === 'season_rating' ? drainSeasonRatingQueue(adapter) : syncPendingOperations(adapter);

  return attempt.then(
    () => 'succeeded',
    () => 'failed',
  );
}

/**
 * The shared contract fixtures (ADR 009 R-4, R-10), run in the JS runtime. The Kotlin runner
 * (`SyncEngineContractFixtureTest.kt`) reads the same files and asserts the same `expect` block.
 */
describe('shared contract fixtures, JS runtime (ADR 009 R-4, R-10)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fakeBridge.restore();
    jest.restoreAllMocks();
  });

  it('runs every anime fixture in both runtimes; only season ratings may be JS-only until T17', () => {
    const jsOnly = fixtures.filter((fixture) => !fixture.runtimes.includes('kotlin'));

    expect(fixtures.length).toBeGreaterThan(0);
    expect(jsOnly.filter((fixture) => fixture.kind !== 'season_rating').map((fixture) => fixture.name)).toEqual([]);
    expect(fixtures.filter((fixture) => !fixture.runtimes.includes('js')).map((fixture) => fixture.name)).toEqual([]);
  });

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))('%s', async (_name, fixture) => {
    const adapter = await openContractDatabase(fixture.given, Date.now());
    const requests: ContractRequest[] = [];
    const outcomes: (ContractAttemptOutcome | undefined)[] = [];

    for (const cycle of fixture.cycles) {
      const before = fakeBridge.requests.length;
      queueContractCycle(fakeBridge, cycle.bridge);
      // Sequential by definition: each attempt starts from the state the previous one left.
      const outcome = await runAttempt(adapter, fixture);
      outcomes.push(cycle.attempt === undefined ? undefined : outcome);
      requests.push(...answeredContractRequests(fakeBridge.requests.slice(before), cycle.bridge));
    }

    expect(outcomes).toEqual(fixture.cycles.map((cycle) => cycle.attempt));
    expect(requests).toEqual(fixture.expect.requests);
    const { requests: _requests, ...expectedState } = fixture.expect;
    expect(await readContractState(adapter, fixture.given, fixture.expect)).toEqual(expectedState);
  });
});
