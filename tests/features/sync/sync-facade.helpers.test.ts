import { inArray } from 'drizzle-orm';
import { createDrizzleDb } from '../../../src/infrastructure/db/client/client.helpers';
import { operationLog, seasonRatingQueue } from '../../../src/infrastructure/db/schema';
import {
  buildPendingOperationsQuery,
  buildUnresolvedSeasonRatingQuery,
  resolveSyncPrerequisites,
} from '../../../src/features/sync/sync-facade.helpers';

jest.mock('drizzle-orm', () => ({
  eq: jest.fn((column, value) => ({ column, value })),
  inArray: jest.fn((column, values) => ({ column, values })),
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  createDrizzleDb: jest.fn(),
}));

jest.mock('../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

jest.mock('../../../src/features/sync/use-initial-sync', () => ({
  initialSync: jest.fn(),
}));

describe('sync facade helpers', () => {
  it('counts pending and processing outbox rows as unresolved work', () => {
    const limit = jest.fn().mockReturnValue({ query: 'pending-operations' });
    const where = jest.fn(() => ({ limit }));
    const from = jest.fn(() => ({ where }));
    const select = jest.fn(() => ({ from }));
    (createDrizzleDb as jest.Mock).mockReturnValue({ select });

    buildPendingOperationsQuery({ id: 'raw-db' } as never);

    expect(inArray).toHaveBeenCalledWith(operationLog.status, ['pending', 'processing']);
    expect(where).toHaveBeenCalledWith({
      column: operationLog.status,
      values: ['pending', 'processing'],
    });
  });

  it('counts pending, syncing, and failed season ratings as unresolved work', () => {
    const limit = jest.fn().mockReturnValue({ query: 'season-rating-queue' });
    const where = jest.fn(() => ({ limit }));
    const from = jest.fn(() => ({ where }));
    const select = jest.fn(() => ({ from }));
    (createDrizzleDb as jest.Mock).mockReturnValue({ select });

    buildUnresolvedSeasonRatingQuery({ id: 'raw-db' } as never);

    expect(inArray).toHaveBeenCalledWith(seasonRatingQueue.status, [
      'pending',
      'syncing',
      'failed',
    ]);
  });
});

describe('resolveSyncPrerequisites', () => {
  it('reads a bridge config that has not answered as unknown, never as missing', () => {
    expect(
      resolveSyncPrerequisites({
        hasDatabase: true,
        configStatus: 'pending',
        isConfigured: false,
      }),
    ).toBe('unknown');
  });

  it('is ready once the config answers as paired', () => {
    expect(
      resolveSyncPrerequisites({
        hasDatabase: true,
        configStatus: 'loaded',
        isConfigured: true,
      }),
    ).toBe('ready');
  });

  it('is missing once the config answers as unpaired', () => {
    expect(
      resolveSyncPrerequisites({
        hasDatabase: true,
        configStatus: 'loaded',
        isConfigured: false,
      }),
    ).toBe('missing');
  });

  it('is missing when the config can no longer be read, even while stale rows still say paired', () => {
    // drizzle keeps serving the last successful rows after a later read rejects, so `isConfigured`
    // can still be true off a config nobody can refresh. Syncing on it would claim a bridge this
    // instance can no longer verify.
    expect(
      resolveSyncPrerequisites({
        hasDatabase: true,
        configStatus: 'unavailable',
        isConfigured: true,
      }),
    ).toBe('missing');
  });

  it('is missing without a database even while the config is still unknown', () => {
    expect(
      resolveSyncPrerequisites({
        hasDatabase: false,
        configStatus: 'pending',
        isConfigured: true,
      }),
    ).toBe('missing');
  });
});
