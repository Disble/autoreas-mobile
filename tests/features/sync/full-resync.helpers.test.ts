import { resyncFromBridgeSnapshot } from '../../../src/features/sync/full-resync.helpers';
import { applyAnimePartial, upsertAnime } from '../../../src/infrastructure/db/anime-repository';
import { getBridgeConfigSnapshot, withLocalWrite } from '../../../src/infrastructure/db/client/client.helpers';
import { fetchInitialSyncSnapshot } from '../../../src/features/sync/initial-sync.helpers';
import { loadPendingOutboxRecordIds } from '../../../src/features/sync/merge/merge-context.helpers';

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  withLocalWrite: jest.fn(),
}));

jest.mock('../../../src/features/sync/initial-sync.helpers', () => ({
  fetchInitialSyncSnapshot: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/anime-repository', () => ({
  applyAnimePartial: jest.fn().mockResolvedValue(undefined),
  upsertAnime: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/features/sync/merge/field-merge.helpers', () => {
  const actual = jest.requireActual('../../../src/features/sync/merge/field-merge.helpers');
  return { ...actual };
});

jest.mock('../../../src/features/sync/merge/merge-context.helpers', () => {
  const actual = jest.requireActual('../../../src/features/sync/merge/merge-context.helpers');
  return {
    ...actual,
    loadPendingOutboxRecordIds: jest.fn().mockResolvedValue(new Set()),
  };
});

/** Mocks `getBridgeConfigSnapshot`, controlling whether the bridge connection is configured. */
const mockGetConfig = getBridgeConfigSnapshot as jest.Mock;
/** Mocks `fetchInitialSyncSnapshot`, standing in for the real bridge `listAnimes` fetch. */
const mockFetch = fetchInitialSyncSnapshot as jest.Mock;
/** Mocks `withLocalWrite`, standing in for the real deferred-write transaction. */
const mockDeferredWrite = withLocalWrite as jest.Mock;
/** Mocks `loadPendingOutboxRecordIds`, controlling which animes have an un-acked local intent. */
const mockPendingIds = loadPendingOutboxRecordIds as jest.Mock;

/** Builds a fixture English bridge wire anime snapshot, including the required OCC token. */
function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'anime-1',
    name: 'Naruto',
    status: 1,
    episodesWatched: 12,
    totalEpisodes: 220,
    days: [],
    genres: [],
    kind: 1,
    active: 1,
    firstCycle: 0,
    lastWatchedAt: null,
    premieredAt: null,
    createdAt: null,
    deletedAt: null,
    cover: null,
    sourceUrl: null,
    folder: null,
    studios: null,
    origin: null,
    durationMinutes: null,
    modified_at: 0,
    ...overrides,
  };
}

/**
 * `fetchInitialSyncSnapshot` is mocked in this suite, so this wraps a wire-shaped snapshot into
 * the `IngestedAnime` pair its real implementation now returns (Decision 10). Wire-shaped, so
 * `normalizeFetchedAnime`'s internal `WireAnimeSchema.safeParse` still succeeds against
 * `entry.anime`, preserving this suite's pre-existing (accidental, documented as drift)
 * exercised behavior byte-for-byte.
 */
function makeIngestedSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return { anime: makeSnapshot(overrides), bridgeModifiedAt: 0 };
}

/** Builds a fixture persisted `animes` row, as it would come back from a raw SQLite select. */
function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: 'anime-1',
    nombre: 'Naruto',
    estado: 1,
    nrocapvisto: 12,
    totalcap: 220,
    dias: JSON.stringify([]),
    generos: JSON.stringify([]),
    tipo: 1,
    activo: 1,
    primeravez: 0,
    fechaUltCapVisto: null,
    fechaEstreno: null,
    fechaCreacion: null,
    fechaEliminacion: null,
    portada: null,
    pagina: null,
    carpeta: null,
    estudios: null,
    origen: null,
    duracion: null,
    lastAppliedChangeMs: 500,
    bridgeModifiedAt: null,
    ...overrides,
  };
}

/** Placeholder raw SQLite handle; every collaborator that reads it is mocked. */
const rawDb = { name: 'raw-db' } as never;

describe('resyncFromBridgeSnapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfig.mockResolvedValue({ ip: '1.2.3.4', port: 9876, token: 'tok' });
    mockPendingIds.mockResolvedValue(new Set());
  });

  function wireWriteWithLocalRows(localRows: unknown[]) {
    (mockDeferredWrite as jest.Mock).mockImplementation(async (_db, task) => {
      const db = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockResolvedValue(localRows),
        }),
      };
      return task(db, db);
    });
  }

  it('heals a diverged row by applying only the differing fields, preserving the guard', async () => {
    // Local is behind by several chapters (5) vs the bridge truth (12); estado also differs.
    wireWriteWithLocalRows([makeRow({ nrocapvisto: 5, estado: 0, lastAppliedChangeMs: 500 })]);
    mockFetch.mockResolvedValue([makeIngestedSnapshot({ nrocapvisto: 12, estado: 1 })]);

    const result = await resyncFromBridgeSnapshot(rawDb);

    expect(applyAnimePartial).toHaveBeenCalledWith(
      expect.anything(),
      'anime-1',
      { nrocapvisto: 12, estado: 1 },
      500, // existing guard preserved, not advanced
    );
    expect(result.healed).toBe(1);
  });

  it('skips animes with an unconfirmed local outbox op (protects local intent)', async () => {
    wireWriteWithLocalRows([makeRow({ nrocapvisto: 5 })]);
    mockFetch.mockResolvedValue([makeIngestedSnapshot({ nrocapvisto: 12 })]);
    mockPendingIds.mockResolvedValue(new Set(['anime-1']));

    const result = await resyncFromBridgeSnapshot(rawDb);

    expect(applyAnimePartial).not.toHaveBeenCalled();
    expect(upsertAnime).not.toHaveBeenCalled();
    expect(result.healed).toBe(0);
  });

  it('cold-inserts an anime that is missing locally', async () => {
    wireWriteWithLocalRows([]);
    const snapshot = makeIngestedSnapshot();
    mockFetch.mockResolvedValue([snapshot]);

    const result = await resyncFromBridgeSnapshot(rawDb);

    expect(upsertAnime).toHaveBeenCalledWith(expect.anything(), {
      _id: 'anime-1',
      nombre: 'Naruto',
      estado: 1,
      nrocapvisto: 12,
      totalcap: 220,
      dias: [],
      generos: [],
      tipo: 1,
      activo: 1,
      primeravez: 0,
      fechaUltCapVisto: null,
      fechaEstreno: null,
      fechaCreacion: null,
      fechaEliminacion: null,
      portada: null,
      pagina: null,
      carpeta: null,
      estudios: null,
      origen: null,
      duracion: null,
    });
    expect(result.healed).toBe(1);
  });

  it('no-ops a row already in sync', async () => {
    wireWriteWithLocalRows([makeRow({ nrocapvisto: 12, estado: 1 })]);
    mockFetch.mockResolvedValue([makeIngestedSnapshot({ nrocapvisto: 12, estado: 1 })]);

    const result = await resyncFromBridgeSnapshot(rawDb);

    expect(applyAnimePartial).not.toHaveBeenCalled();
    expect(result.healed).toBe(0);
  });

  it('returns healed:0 without fetching when bridge config is incomplete', async () => {
    mockGetConfig.mockResolvedValue(null);

    const result = await resyncFromBridgeSnapshot(rawDb);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.healed).toBe(0);
  });

  it('propaga el error cuando el snapshot wire en inglés es inválido y no lo esconde como healed:0', async () => {
    wireWriteWithLocalRows([makeRow({ nrocapvisto: 5 })]);
    mockFetch.mockRejectedValue(new Error('Invalid anime list from bridge: bad payload'));

    await expect(resyncFromBridgeSnapshot(rawDb)).rejects.toThrow(
      'Invalid anime list from bridge: bad payload'
    );
  });

  it('never surfaces bridgeModifiedAt as a changed field, even when the local row carries a token (MERGEABLE_FIELDS is an explicit whitelist)', async () => {
    wireWriteWithLocalRows([
      makeRow({ nrocapvisto: 5, estado: 0, lastAppliedChangeMs: 500, bridgeModifiedAt: 1788540735366 }),
    ]);
    mockFetch.mockResolvedValue([makeIngestedSnapshot({ nrocapvisto: 12, estado: 1 })]);

    await resyncFromBridgeSnapshot(rawDb);

    const [, , columns] = (applyAnimePartial as jest.Mock).mock.calls[0];
    expect(columns).not.toHaveProperty('bridgeModifiedAt');
    expect(columns).not.toHaveProperty('bridge_modified_at');
  });

  it('reads pending outbox ids and local rows independently, regardless of resolve order', async () => {
    // loadPendingOutboxRecordIds resolves AFTER the local rows select to prove the two reads
    // are not sequenced through each other's result (parallelized via Promise.all).
    let resolvePendingIds!: (ids: Set<string>) => void;
    mockPendingIds.mockReturnValue(
      new Promise((resolve) => {
        resolvePendingIds = resolve;
      }),
    );
    (mockDeferredWrite as jest.Mock).mockImplementation(async (_db, task) => {
      const db = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockResolvedValue([makeRow({ nrocapvisto: 5 })]),
        }),
      };
      const taskPromise = task(db, db);
      resolvePendingIds(new Set());
      return taskPromise;
    });
    mockFetch.mockResolvedValue([makeIngestedSnapshot({ episodesWatched: 12 })]);

    const result = await resyncFromBridgeSnapshot(rawDb);

    expect(result.healed).toBe(1);
  });
});
