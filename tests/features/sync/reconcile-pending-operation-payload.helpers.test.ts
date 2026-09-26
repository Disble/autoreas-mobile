import { buildReconcileRequestBody } from '../../../src/features/sync/reconcile-request.helpers';
import { getConfirmedOperationIds } from '../../../src/features/sync/reconcile-confirmation.helpers';

describe('reconcile pending operation payload helpers', () => {
  const baseOperation = {
    id: 1,
    animeId: 'anime-1',
    operation: 'update',
    payload: JSON.stringify({ episodesWatched: 5, lastWatchedAt: 1710000000000 }),
    status: 'processing',
    createdAt: 1710000000000,
    conflictAttemptCount: 0,
  };

  it('omits device_id when missing and keeps malformed payloads on the safe empty-object fallback', () => {
    expect(
      buildReconcileRequestBody(undefined, 0, [
        {
          ...baseOperation,
          payload: '{',
        },
      ]),
    ).toEqual({
      device_id: undefined,
      last_changelog_id: 0,
      pending_operations: [
        {
          anime_id: 'anime-1',
          operation: 'update',
          payload: {},
          created_at: 1710000000000,
        },
      ],
    });
  });

  it('keeps the safe empty-object fallback for stored non-object JSON payloads', () => {
    expect(
      buildReconcileRequestBody(undefined, 0, [
        {
          ...baseOperation,
          payload: '[]',
        },
      ]),
    ).toEqual({
      device_id: undefined,
      last_changelog_id: 0,
      pending_operations: [
        {
          anime_id: 'anime-1',
          operation: 'update',
          payload: {},
          created_at: 1710000000000,
        },
      ],
    });
  });

  it('normalizes legacy aliases to the English reconcile contract before transport', () => {
    expect(
      buildReconcileRequestBody('device-1', 7, [
        {
          ...baseOperation,
          payload: JSON.stringify({
            nrocapvisto: 5,
            fechaUltCapVisto: 1710000000000,
            estado: 1,
            dias: ['Monday'],
            firstCycle: true,
          }),
        },
      ]),
    ).toEqual({
      device_id: 'device-1',
      last_changelog_id: 7,
      pending_operations: [
        {
          anime_id: 'anime-1',
          operation: 'update',
          payload: {
            episodesWatched: 5,
            lastWatchedAt: 1710000000000,
            status: 1,
            days: ['Monday'],
            firstCycle: true,
          },
          created_at: 1710000000000,
        },
      ],
    });
  });

  it('prefers English keys over legacy aliases and preserves unrelated payload properties', () => {
    expect(
      buildReconcileRequestBody('device-1', 7, [
        {
          ...baseOperation,
          payload: JSON.stringify({
            nrocapvisto: 5,
            episodesWatched: 6,
            estado: 1,
            status: 2,
            extra: true,
          }),
        },
      ]),
    ).toEqual({
      device_id: 'device-1',
      last_changelog_id: 7,
      pending_operations: [
        {
          anime_id: 'anime-1',
          operation: 'update',
          payload: {
            episodesWatched: 6,
            status: 2,
            extra: true,
          },
          created_at: 1710000000000,
        },
      ],
    });
  });

  it('normalizes legacy aliases before fallback confirmation checks bridge evidence', () => {
    expect(
      getConfirmedOperationIds(
        [
          {
            ...baseOperation,
            payload: JSON.stringify({ nrocapvisto: 5, fechaUltCapVisto: 1710000000000 }),
          },
        ],
        undefined,
        [
          {
            record_id: 'anime-1',
            change_type: 'update',
            changed_fields: ['episodesWatched', 'lastWatchedAt'],
            timestamp: 1710000001000,
          },
        ],
      ),
    ).toEqual([1]);
  });

  it('confirms via the bridge snapshot when a field is absent from changed_fields but already matches there', () => {
    expect(
      getConfirmedOperationIds(
        [
          {
            ...baseOperation,
            payload: JSON.stringify({ episodesWatched: 5 }),
          },
        ],
        undefined,
        [
          {
            record_id: 'anime-1',
            change_type: 'update',
            // `episodesWatched` is missing from changed_fields, so confirmation can only come
            // from the snapshot already carrying the same value the outbox row sent.
            changed_fields: ['status'],
            snapshot: { episodesWatched: 5 } as never,
            timestamp: 1710000001000,
          },
        ],
      ),
    ).toEqual([1]);
  });

  it('does not confirm when the field is absent from changed_fields and the snapshot value differs', () => {
    expect(
      getConfirmedOperationIds(
        [
          {
            ...baseOperation,
            payload: JSON.stringify({ episodesWatched: 5 }),
          },
        ],
        undefined,
        [
          {
            record_id: 'anime-1',
            change_type: 'update',
            changed_fields: ['status'],
            snapshot: { episodesWatched: 4 } as never,
            timestamp: 1710000001000,
          },
        ],
      ),
    ).toEqual([]);
  });
});
