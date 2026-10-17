import { inArray } from 'drizzle-orm';
import { createDrizzleDb } from '../../../src/infrastructure/db/client/client.helpers';
import { operationLog } from '../../../src/infrastructure/db/schema';
import {
  buildPendingOperationsQuery,
  resolveSyncPrerequisites,
} from '../../../src/features/sync/sync-facade.helpers';

jest.mock('drizzle-orm', () => ({
  inArray: jest.fn((column, values) => ({ column, values })),
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  createDrizzleDb: jest.fn(),
}));

jest.mock('../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

describe('sync facade helpers', () => {
  it('counts pending and processing outbox rows, edits and ratings alike, as unresolved work', () => {
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
