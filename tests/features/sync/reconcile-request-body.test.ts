import { buildReconcileRequestBody } from '../../../src/features/sync/reconcile-request.helpers';
import type { OperationLogRow } from '../../../src/infrastructure/db/schema';

/** Builds one persisted outbox row so each test only states what it actually exercises. */
function buildOperation(overrides: Partial<OperationLogRow> = {}): OperationLogRow {
  return {
    id: 1,
    animeId: 'anime-1',
    operation: 'update',
    payload: JSON.stringify({ episodesWatched: 5 }),
    status: 'processing',
    createdAt: 1710000000000,
    ...overrides,
  } as OperationLogRow;
}

describe('buildReconcileRequestBody', () => {
  it('emite el contrato base sin campos de más', () => {
    const body = buildReconcileRequestBody('device-1', 2259, [buildOperation()]);

    expect(body).toEqual({
      device_id: 'device-1',
      last_changelog_id: 2259,
      pending_operations: [
        {
          anime_id: 'anime-1',
          operation: 'update',
          payload: { episodesWatched: 5 },
          created_at: 1710000000000,
        },
      ],
    });
  });

  it('nunca lleva client_telemetry, ni con operaciones ni con tokens base', () => {
    // Ausencia de la clave, no `undefined` ni `null`: el bridge guarda el body CRUDO verbatim,
    // así que una clave vacía es ruido permanente en su store. Ningún caller JS arma telemetría.
    const body = buildReconcileRequestBody(
      'device-1',
      2259,
      [buildOperation()],
      new Map<string, number | null>([['anime-1', 7]]),
    );

    expect(body).toEqual({
      device_id: 'device-1',
      last_changelog_id: 2259,
      pending_operations: [
        {
          anime_id: 'anime-1',
          operation: 'update',
          payload: { episodesWatched: 5 },
          created_at: 1710000000000,
          base: 7,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('client_telemetry');
  });

  describe('base token emission (Part 2, Requirement 9)', () => {
    it('omits the base key entirely on serialized bytes for an anime with an unknown (NULL) token', () => {
      const bridgeTokensByAnimeId = new Map<string, number | null>([['anime-1', null]]);
      const body = buildReconcileRequestBody(
        'device-1',
        2259,
        [buildOperation({ animeId: 'anime-1' })],
        bridgeTokensByAnimeId,
      );

      // Asserted on serialized BYTES, not object nullability -- an object-level assertion
      // passes while the bug ships (design.md Decision 4 / invariant 2).
      expect(JSON.stringify(body)).not.toContain('"base"');
    });

    it('emits "base":0 on serialized bytes for a stored zero token, never omitted', () => {
      const bridgeTokensByAnimeId = new Map<string, number | null>([['anime-1', 0]]);
      const body = buildReconcileRequestBody(
        'device-1',
        2259,
        [buildOperation({ animeId: 'anime-1' })],
        bridgeTokensByAnimeId,
      );

      expect(JSON.stringify(body)).toContain('"base":0');
    });

    it('emits the known nonzero base for every operation whose anime carries one', () => {
      const bridgeTokensByAnimeId = new Map<string, number | null>([
        ['anime-1', 1788540735366],
        ['anime-2', 200],
      ]);
      const body = buildReconcileRequestBody(
        'device-1',
        2259,
        [
          buildOperation({ id: 1, animeId: 'anime-1' }),
          buildOperation({ id: 2, animeId: 'anime-2' }),
        ],
        bridgeTokensByAnimeId,
      );

      expect(body.pending_operations).toEqual([
        expect.objectContaining({ anime_id: 'anime-1', base: 1788540735366 }),
        expect.objectContaining({ anime_id: 'anime-2', base: 200 }),
      ]);
    });

    it('never omits base for an operation whose anime has a known token, across a mixed batch (invariant 8)', () => {
      const bridgeTokensByAnimeId = new Map<string, number | null>([
        ['anime-known', 500],
        ['anime-zero', 0],
        // anime-unknown intentionally absent from the map.
      ]);
      const body = buildReconcileRequestBody(
        'device-1',
        2259,
        [
          buildOperation({ id: 1, animeId: 'anime-known' }),
          buildOperation({ id: 2, animeId: 'anime-zero' }),
          buildOperation({ id: 3, animeId: 'anime-unknown' }),
        ],
        bridgeTokensByAnimeId,
      );

      for (const operation of body.pending_operations) {
        const hasKnownToken =
          operation.anime_id === 'anime-known' || operation.anime_id === 'anime-zero';

        expect('base' in operation).toBe(hasKnownToken);
      }
    });

    it('backward compatible: omitting the token map entirely omits every base key, byte-identical to Part 1', () => {
      const body = buildReconcileRequestBody('device-1', 2259, [buildOperation()]);

      expect(JSON.stringify(body)).not.toContain('"base"');
    });
  });

  describe('at most one operation per anime per batch (Requirement 10)', () => {
    it('never contains two operations for the same anime_id when fed a dedup-deduplicated batch', () => {
      // `readOperationLogBacklog`'s `dedupeBy: 'anime_id'` already guarantees this upstream;
      // this pins that `buildReconcileRequestBody` is a faithful pass-through and never
      // reintroduces a duplicate anime_id of its own accord.
      const body = buildReconcileRequestBody('device-1', 2259, [
        buildOperation({ id: 1, animeId: 'anime-1' }),
        buildOperation({ id: 2, animeId: 'anime-2' }),
        buildOperation({ id: 3, animeId: 'anime-3' }),
      ]);

      const animeIds = body.pending_operations.map((operation) => operation.anime_id);
      expect(new Set(animeIds).size).toBe(animeIds.length);
    });
  });
});
