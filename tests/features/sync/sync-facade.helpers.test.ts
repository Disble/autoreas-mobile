import { inArray } from 'drizzle-orm';
import { createDrizzleDb } from '../../../src/infrastructure/db/client/client.helpers';
import { operationLog, seasonRatingQueue } from '../../../src/infrastructure/db/schema';
import {
  buildPendingOperationsQuery,
  buildUnresolvedSeasonRatingQuery,
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
