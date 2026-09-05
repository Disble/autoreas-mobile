import { buildReconcileRequestBody } from '../../../src/features/sync/reconcile-request.helpers';
import type { OperationLogRow } from '../../../src/infrastructure/db/schema';
import type { WireSyncCycleTelemetry } from '../../../src/features/sync/sync-telemetry.types';

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

/**
 * One already-serialized cycle post-mortem, in the exact snake_case shape the bridge receives.
 * It is a wire payload and not a builder call on purpose: these tests assert how the body carries
 * telemetry, so the telemetry itself has to be a fixed value rather than a moving derivation.
 */
const WIRE_TELEMETRY: WireSyncCycleTelemetry = {
  cycle_id: '5f6d4c3b-2a19-4e87-9d0f-1a2b3c4d5e6f',
  trigger_source: 'background_task',
  app_state: 'background',
  previous_cycle: {
    cycle_id: '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
    trigger_source: 'background_task',
    outcome: 'never_closed',
    last_stage: 'apply_write',
    started_at: 1710000000000,
    elapsed_ms: 600000,
    error_name: null,
    native_errcode_byte: null,
    error_stage: null,
    error_cause: null,
    error_fingerprint: null,
  },
  counters: {
    consecutive_unclosed_cycles: 5,
    pending_ops_count: 1,
    cursor: 2259,
  },
  recent_events: [
    { source: 'websocket', event: 'ws_closed', cause: null, first_at: 100, last_at: 900, count: 4 },
  ],
};

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

  it('OMITE client_telemetry por completo cuando no hay telemetría', () => {
    // Ausencia de la clave, no `undefined` ni `null`: el bridge guarda el body CRUDO verbatim,
    // así que una clave vacía es ruido permanente en su store, no un detalle de serialización.
    const body = buildReconcileRequestBody('device-1', 2259, []);

    expect('client_telemetry' in body).toBe(false);
  });

  it('OMITE client_telemetry cuando el cap lo rechazó por presupuesto', () => {
    // `capWireSyncCycleTelemetry` devuelve null antes que mandar algo fuera de presupuesto.
    // Ese null tiene que traducirse a ausencia, no a una clave nula.
    const body = buildReconcileRequestBody('device-1', 2259, [], null);

    expect('client_telemetry' in body).toBe(false);
  });

  it('adjunta client_telemetry sin tocar el resto del contrato', () => {
    const body = buildReconcileRequestBody('device-1', 2259, [], WIRE_TELEMETRY);

    expect(body).toEqual({
      device_id: 'device-1',
      last_changelog_id: 2259,
      pending_operations: [],
      client_telemetry: WIRE_TELEMETRY,
    });
  });

  it('no filtra el mensaje crudo de error dentro del body serializado', () => {
    const serialized = JSON.stringify(
      buildReconcileRequestBody('device-1', 2259, [buildOperation()], WIRE_TELEMETRY)
    );

    expect(serialized).not.toContain('NativeDatabase');
    expect(serialized).not.toContain('/data/user/');
  });

  describe('base token emission (Part 2, Requirement 9)', () => {
    it('omits the base key entirely on serialized bytes for an anime with an unknown (NULL) token', () => {
      const bridgeTokensByAnimeId = new Map<string, number | null>([['anime-1', null]]);
      const body = buildReconcileRequestBody(
        'device-1',
        2259,
        [buildOperation({ animeId: 'anime-1' })],
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
