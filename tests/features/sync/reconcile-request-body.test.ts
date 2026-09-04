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
});
