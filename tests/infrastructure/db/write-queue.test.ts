import type { SQLiteDatabase } from 'expo-sqlite';
import { withLocalWrite } from '../../../src/infrastructure/db/client/client.helpers';

jest.mock('drizzle-orm', () => ({
  desc: jest.fn((value: unknown) => value),
}));

jest.mock('../../../src/infrastructure/db/migrations/migrations', () => ({
  __esModule: true,
  default: { journal: { entries: [] }, migrations: {} },
}));

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: jest.fn(() => () => ({})),
  getDrizzleMigrator: jest.fn(),
  getOpenDatabaseSync: jest.fn(),
}));

/**
 * These tests characterise the SQLite write queue against the failure reported from the field:
 * chapter +/- buttons that reject with `database is locked` and stay broken until the app is
 * force-closed. They assert the behaviour the queue SHOULD have, so a failure here is the proof
 * that the reported defect is real rather than a hypothesis.
 */
describe('sqlite write queue', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('serialises writes across every connection opened against the same database file', async () => {
    // The sync runtimes open the SAME file with `useNewConnection: true`. Queueing per connection
    // object leaves those writers uncoordinated, so they collide at the SQLite level instead.
    // Both mocks share the SAME explicit, non-default `databasePath` so the assertion proves the
    // real path-key branch -- if they were left undefined, both would collide on the
    // `?? DATABASE_NAME` fallback instead and the test would pass without exercising the key.
    const sharedDatabasePath = '/data/user/0/com.autoreas/databases/autoreas.db';
    const foregroundDb = buildRawDb(sharedDatabasePath);
    const syncDb = buildRawDb(sharedDatabasePath);
    const order: string[] = [];
    let releaseForeground: (() => void) | undefined;

    const foregroundWrite = withLocalWrite(foregroundDb, async () => {
      order.push('foreground:start');
      await new Promise<void>((resolve) => {
        releaseForeground = resolve;
      });
      order.push('foreground:end');
    });

    const syncWrite = withLocalWrite(syncDb, async () => {
      order.push('sync:start');
    });

    await jest.advanceTimersByTimeAsync(0);
    releaseForeground?.();
    await Promise.all([foregroundWrite, syncWrite]);

    expect(order).toStrictEqual(['foreground:start', 'foreground:end', 'sync:start']);
  });
});

function buildRawDb(databasePath: string): SQLiteDatabase {
  return {
    databasePath,
    execAsync: jest.fn().mockResolvedValue(undefined),
  } as unknown as SQLiteDatabase;
}
