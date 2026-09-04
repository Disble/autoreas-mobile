import {
  buildAnimeRow,
  buildAppliedOperation,
  buildOperationLogRow,
  buildReconcileResponseBody,
} from '../sync-fixtures.helpers';

describe('buildAnimeRow', () => {
  it('produces a schema-valid row with every NOT NULL column defaulted', () => {
    const row = buildAnimeRow();

    expect(row).toMatchObject({
      nombre: expect.any(String),
      estado: 0,
      nrocapvisto: 0,
      activo: 1,
      primeravez: 1,
    });
    expect(typeof row._id).toBe('string');
  });

  it('gives two default rows distinct ids so they can coexist in the same table', () => {
    const first = buildAnimeRow();
    const second = buildAnimeRow();

    expect(first._id).not.toBe(second._id);
  });

  it('lets a caller override any field, including the id', () => {
    const row = buildAnimeRow({ _id: 'anime-fixed', estado: 2, nrocapvisto: 5 });

    expect(row).toMatchObject({ _id: 'anime-fixed', estado: 2, nrocapvisto: 5 });
  });
});

describe('buildOperationLogRow', () => {
  it('JSON-encodes the payload the same way the app persists it', () => {
    const row = buildOperationLogRow({ payload: { estado: 2 } });

    expect(row.payload).toBe(JSON.stringify({ estado: 2 }));
    expect(row.status).toBe('pending');
    expect(row.operation).toBe('update');
  });

  it('defaults to an empty payload object when none is given', () => {
    const row = buildOperationLogRow();

    expect(row.payload).toBe('{}');
  });
});

describe('buildAppliedOperation', () => {
  it('confirms one operation as applied by default', () => {
    const appliedOperation = buildAppliedOperation({ anime_id: 'anime-1', operation: 'update' });

    expect(appliedOperation).toEqual({ anime_id: 'anime-1', operation: 'update', applied: true });
  });
});

describe('buildReconcileResponseBody', () => {
  it('defaults to an empty confirmed batch matching ReconcileResponseSchema', () => {
    const body = buildReconcileResponseBody();

    expect(body).toEqual({
      status: 'ok',
      applied_operations: [],
      bridge_changes: [],
      last_changelog_id: undefined,
    });
  });

  it('layers real applied operations and bridge changes onto the default shape', () => {
    const appliedOperation = buildAppliedOperation({ anime_id: 'anime-1', operation: 'update' });

    const body = buildReconcileResponseBody({
      appliedOperations: [appliedOperation],
      lastChangelogId: 42,
    });

    expect(body.applied_operations).toEqual([appliedOperation]);
    expect(body.last_changelog_id).toBe(42);
  });
});
