import { resyncFromBridgeSnapshot } from '../../../src/features/sync/full-resync.helpers';
import { applyAnimePartial, upsertAnime } from '../../../src/infrastructure/db/anime-repository';
import { getBridgeConfigSnapshot, withDeferredWrite } from '../../../src/infrastructure/db/client';
import { fetchInitialSyncSnapshot } from '../../../src/features/sync/initial-sync.helpers';
import { loadPendingOutboxRecordIds } from '../../../src/features/sync/merge/merge-context.helpers';

jest.mock('../../../src/infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  withDeferredWrite: jest.fn(),
}));

jest.mock('../../../src/features/sync/initial-sync.helpers', () => ({
  fetchInitialSyncSnapshot: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/anime-repository', () => ({
  applyAnimePartial: jest.fn().mockResolvedValue(undefined),
  upsertAnime: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/features/sync/merge/merge-context.helpers', () => ({
  loadPendingOutboxRecordIds: jest.fn().mockResolvedValue(new Set()),
}));

const mockGetConfig = getBridgeConfigSnapshot as jest.Mock;
const mockFetch = fetchInitialSyncSnapshot as jest.Mock;
const mockDeferredWrite = withDeferredWrite as jest.Mock;
const mockPendingIds = loadPendingOutboxRecordIds as jest.Mock;

function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  };
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...makeSnapshot(),
    dias: JSON.stringify([]),
    generos: JSON.stringify([]),
    lastAppliedChangeMs: 500,
    ...overrides,
  };
}

const rawDb = { name: 'raw-db' } as never;

describe('resyncFromBridgeSnapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfig.mockResolvedValue({ ip: '1.2.3.4', port: 8080, token: 'tok' });
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
    mockFetch.mockResolvedValue([makeSnapshot({ nrocapvisto: 12, estado: 1 })]);

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
    mockFetch.mockResolvedValue([makeSnapshot({ nrocapvisto: 12 })]);
    mockPendingIds.mockResolvedValue(new Set(['anime-1']));

    const result = await resyncFromBridgeSnapshot(rawDb);

    expect(applyAnimePartial).not.toHaveBeenCalled();
    expect(upsertAnime).not.toHaveBeenCalled();
    expect(result.healed).toBe(0);
  });

  it('cold-inserts an anime that is missing locally', async () => {
    wireWriteWithLocalRows([]);
    const snapshot = makeSnapshot();
    mockFetch.mockResolvedValue([snapshot]);

    const result = await resyncFromBridgeSnapshot(rawDb);

    expect(upsertAnime).toHaveBeenCalledWith(expect.anything(), snapshot);
    expect(result.healed).toBe(1);
  });

  it('no-ops a row already in sync', async () => {
    wireWriteWithLocalRows([makeRow({ nrocapvisto: 12, estado: 1 })]);
    mockFetch.mockResolvedValue([makeSnapshot({ nrocapvisto: 12, estado: 1 })]);

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
});
