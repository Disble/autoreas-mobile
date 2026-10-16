import type * as OutboxClaimHelpers from '../../src/features/sync/outbox-claim.helpers';
import type * as OperationLogRetentionHelpers from '../../src/features/sync/operation-log-retention.helpers';

/**
 * Builds a pass-through `outbox-claim.helpers` module for unit tests that already mock
 * `readOperationLogBacklog` and stub the write door. The claim skips the door and is read from
 * that mocked backlog, every claimed row stays held, and no chain successor is ever claimed, so
 * those tests keep asserting what they own. The claim SQL itself is pinned against real SQLite
 * in `tests/behaviour/sync/outbox-claims.behaviour.test.ts` and
 * `tests/behaviour/sync/outbox-chain.behaviour.test.ts`.
 */
export function buildPassThroughOutboxClaimModule(): typeof OutboxClaimHelpers {
  const actual = jest.requireActual<typeof OutboxClaimHelpers>(
    '../../src/features/sync/outbox-claim.helpers',
  );
  const retention = jest.requireMock<typeof OperationLogRetentionHelpers>(
    '../../src/features/sync/operation-log-retention.helpers',
  );

  return {
    ...actual,
    claimOperationLogBatch: jest.fn(async (rawDb, params) => {
      const rows = await retention.readOperationLogBacklog(rawDb, {
        status: ['pending', 'processing'],
        limit: params.limit,
        orderBy: 'oldest_first',
        dedupeBy: 'anime_id',
      });

      if (rows.length > 0) {
        params.onClaim?.();
      }

      return { claim: { owner: params.owner, claimedAt: 0 }, rows };
    }),
    readHeldOperationIds: jest.fn(async (_db, ids) => [...ids]),
    claimChainSuccessors: jest.fn(async () => []),
  };
}
