import {
  appendDiagnosticEvent,
  toWireDiagnosticEvents,
} from '../../../src/features/sync/sync-diagnostic-events.helpers';
import { createSyncCycleId } from '../../../src/features/sync/sync-telemetry.helpers';
import { SYNC_DIAGNOSTIC_EVENT_RING_SIZE } from '../../../src/features/sync/sync-diagnostic-events.constants';
import type { SyncDiagnosticEvent } from '../../../src/features/sync/sync-diagnostic-events.types';

/** Builds one ring entry so each test only states the dimensions it actually exercises. */
function buildEvent(overrides: Partial<SyncDiagnosticEvent> = {}): SyncDiagnosticEvent {
  return {
    source: 'websocket',
    event: 'ws_opened',
    cause: null,
    firstAt: 1710000000000,
    lastAt: 1710000000000,
    count: 1,
    ...overrides,
  };
}

describe('appendDiagnosticEvent', () => {
  it('agrega el primer evento', () => {
    const ring = appendDiagnosticEvent([], buildEvent());

    expect(ring).toHaveLength(1);
    expect(ring[0].count).toBe(1);
  });

  it('COALESCE eventos idénticos en vez de repetirlos', () => {
    // Sin esto, 48 timeouts iguales llenan el anillo y expulsan cualquier otra señal -- justo la
    // señal que se necesita para ver el patrón queda sepultada por su propia repetición.
    const first = buildEvent({ firstAt: 1710000000000, lastAt: 1710000000000 });
    const second = buildEvent({ firstAt: 1710000600000, lastAt: 1710000600000 });

    const ring = appendDiagnosticEvent(appendDiagnosticEvent([], first), second);

    expect(ring).toHaveLength(1);
    expect(ring[0].count).toBe(2);
  });

  it('el coalescing conserva el PRIMER instante y avanza el último', () => {
    // Los dos extremos juntos son lo que dice "esto lleva 10 horas pasando" en vez de
    // "esto pasó recién": una sola marca de tiempo no distingue un incidente de un evento.
    const ring = appendDiagnosticEvent(
      appendDiagnosticEvent([], buildEvent({ firstAt: 100, lastAt: 100 })),
      buildEvent({ firstAt: 900, lastAt: 900 }),
    );

    expect(ring[0].firstAt).toBe(100);
    expect(ring[0].lastAt).toBe(900);
  });

  it('NO coalesce cuando cambia la causa, aunque coincidan source y event', () => {
    // Un write que falla por handle cerrado y otro por contención son incidentes distintos
    // con fixes distintos. Fundirlos borraría exactamente la distinción que se busca.
    const ring = appendDiagnosticEvent(
      appendDiagnosticEvent([], buildEvent({ source: 'sync_cycle', event: 'write_failed', cause: 'closed_resource' })),
      buildEvent({ source: 'sync_cycle', event: 'write_failed', cause: 'lock_contention' }),
    );

    expect(ring).toHaveLength(2);
  });

  it('expulsa el MÁS VIEJO cuando el anillo se llena', () => {
    let ring: readonly SyncDiagnosticEvent[] = [];

    for (let index = 0; index < SYNC_DIAGNOSTIC_EVENT_RING_SIZE + 3; index += 1) {
      ring = appendDiagnosticEvent(ring, buildEvent({ cause: `c${index}` as never, lastAt: index }));
    }

    expect(ring).toHaveLength(SYNC_DIAGNOSTIC_EVENT_RING_SIZE);
    expect(ring[ring.length - 1].lastAt).toBe(SYNC_DIAGNOSTIC_EVENT_RING_SIZE + 2);
  });

  it('un evento que REAPARECE se rejuvenece y sobrevive a la expulsión', () => {
    // La antigüedad tiene que significar "última vez visto", no "primera vez visto". Si no, un
    // incidente en curso se cae de la ventana justamente por haber durado, que es al revés de
    // lo que se necesita.
    let ring = appendDiagnosticEvent([], buildEvent({ event: 'ws_closed', firstAt: 1, lastAt: 1 }));

    for (let index = 0; index < 5; index += 1) {
      ring = appendDiagnosticEvent(ring, buildEvent({ cause: `old${index}` as never, lastAt: 10 + index }));
    }

    // Reaparece: pasa a ser la entrada MÁS RECIENTE del anillo.
    ring = appendDiagnosticEvent(ring, buildEvent({ event: 'ws_closed', firstAt: 900, lastAt: 900 }));

    // Se agregan los justos para desbordar por UNO. La víctima tiene que ser el relleno más
    // viejo, no la entrada que reapareció recién.
    for (let index = 0; index < SYNC_DIAGNOSTIC_EVENT_RING_SIZE - 5; index += 1) {
      ring = appendDiagnosticEvent(ring, buildEvent({ cause: `new${index}` as never, lastAt: 1000 + index }));
    }

    const wsClosed = ring.find((entry) => entry.event === 'ws_closed');

    expect(ring).toHaveLength(SYNC_DIAGNOSTIC_EVENT_RING_SIZE);
    expect(ring.find((entry) => entry.cause === ('old0' as never))).toBeUndefined();
    expect(wsClosed?.count).toBe(2);
    expect(wsClosed?.firstAt).toBe(1);
  });
});

describe('toWireDiagnosticEvents', () => {
  it('serializa a snake_case con vocabulario cerrado y nada más', () => {
    const wire = toWireDiagnosticEvents([
      buildEvent({
        source: 'sync_cycle',
        event: 'write_failed',
        cause: 'closed_resource',
        firstAt: 100,
        lastAt: 900,
        count: 3,
      }),
    ]);

    expect(wire).toEqual([
      {
        source: 'sync_cycle',
        event: 'write_failed',
        cause: 'closed_resource',
        first_at: 100,
        last_at: 900,
        count: 3,
      },
    ]);
  });

  it('devuelve un arreglo vacío cuando no hay eventos', () => {
    expect(toWireDiagnosticEvents([])).toEqual([]);
  });
});

describe('createSyncCycleId', () => {
  it('usa el generador inyectado', () => {
    expect(createSyncCycleId(() => 'fixed-id')).toBe('fixed-id');
  });

  it('por defecto sale del CSPRNG de la plataforma, con forma UUID v4', () => {
    // `Math.random` no garantiza distribución uniforme ni ausencia de colisiones entre
    // procesos, y un cycle_id colisionado funde los ciclos de dos dispositivos en las capturas
    // del bridge: una respuesta equivocada que se lee como válida.
    expect(createSyncCycleId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('dos llamadas consecutivas difieren', () => {
    expect(createSyncCycleId()).not.toBe(createSyncCycleId());
  });
});
