import type { SQLiteDatabase } from 'expo-sqlite';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { openDatabase, pullOnly } from './season-rating-fixtures.helpers';

// Same seam as `season-rating-outbox.behaviour.test.ts`: only the drizzle factory is swapped.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** A pull answer that states the bridge's season mode, with the cursor moved to 1. */
function pullWithSeasonMode(seasonMode: boolean) {
  const answer = pullOnly();

  return { ...answer, body: { ...answer.body, season_mode: seasonMode } };
}

/** Reads the stored season mode and the cursor written beside it. */
function readBridgeConfig(adapter: SQLiteDatabase) {
  return adapter.getFirstAsync<{ season_mode: number; last_changelog_id: number }>(
    'SELECT season_mode, last_changelog_id FROM bridge_config WHERE id = 1',
  );
}

describe('the reconcile answer carries season mode into bridge_config (S2)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
    jest.restoreAllMocks();
  });

  it('stores season_mode true, then false, with the cursor of the same answer', async () => {
    const adapter = await openDatabase();

    fakeBridge.queueResponse(pullWithSeasonMode(true));
    await syncPendingOperations(adapter);
    expect(await readBridgeConfig(adapter)).toEqual({ season_mode: 1, last_changelog_id: 1 });

    fakeBridge.queueResponse(pullWithSeasonMode(false));
    await syncPendingOperations(adapter);
    expect(await readBridgeConfig(adapter)).toEqual({ season_mode: 0, last_changelog_id: 1 });
  });

  it('leaves the stored season mode alone when the answer does not state one', async () => {
    const adapter = await openDatabase();
    fakeBridge.queueResponse(pullWithSeasonMode(true));
    await syncPendingOperations(adapter);

    fakeBridge.queueResponse(pullOnly());
    await syncPendingOperations(adapter);

    expect(await readBridgeConfig(adapter)).toEqual({ season_mode: 1, last_changelog_id: 1 });
  });

  it('rejects an answer whose season_mode is null, writing neither the mode nor the cursor', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const adapter = await openDatabase();
    const answer = pullOnly();
    fakeBridge.queueResponse({ ...answer, body: { ...answer.body, season_mode: null } });

    await expect(syncPendingOperations(adapter)).rejects.toThrow();

    expect(await readBridgeConfig(adapter)).toEqual({ season_mode: 0, last_changelog_id: 0 });
  });
});
