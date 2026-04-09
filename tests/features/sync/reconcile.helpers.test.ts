import {
  buildReconcileRequestBody,
  getConfirmedOperationIds,
} from '../../../src/features/sync/reconcile.helpers';

describe('reconcile helpers', () => {
  const baseOperation = {
    id: 1,
    animeId: 'anime-1',
    operation: 'update',
    payload: JSON.stringify({ nrocapvisto: 5, fechaUltCapVisto: 1710000000000 }),
    status: 'processing',
    createdAt: 1710000000000,
  };

  it('buildReconcileRequestBody omite device_id cuando falta y parsea payloads invalidos', () => {
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

  it('getConfirmedOperationIds confirma updates cuando bridge refleja los campos aplicados', () => {
    expect(
      getConfirmedOperationIds([baseOperation], undefined, [
        {
          record_id: 'anime-1',
          change_type: 'update',
          changed_fields: ['nrocapvisto', 'fechaUltCapVisto'],
          timestamp: 1710000001000,
        },
      ]),
    ).toEqual([1]);
  });

  it('getConfirmedOperationIds prioriza applied_operations cuando bridge manda ack explícito', () => {
    expect(
      getConfirmedOperationIds(
        [baseOperation],
        [
          {
            anime_id: 'anime-1',
            operation: 'update',
            applied: true,
          },
        ],
        [],
      ),
    ).toEqual([1]);
  });

  it('getConfirmedOperationIds no confirma cuando applied_operations dice applied=false', () => {
    expect(
      getConfirmedOperationIds(
        [baseOperation],
        [
          {
            anime_id: 'anime-1',
            operation: 'update',
            applied: false,
          },
        ],
        [
          {
            record_id: 'anime-1',
            change_type: 'update',
            changed_fields: ['nrocapvisto', 'fechaUltCapVisto'],
            timestamp: 1710000001000,
          },
        ],
      ),
    ).toEqual([]);
  });

  it('getConfirmedOperationIds no confirma operaciones sin evidencia de aplicación', () => {
    expect(
      getConfirmedOperationIds([baseOperation], undefined, [
        {
          record_id: 'otro-anime',
          change_type: 'update',
          changed_fields: ['nrocapvisto'],
          timestamp: 1710000001000,
        },
      ]),
    ).toEqual([]);
  });
});
