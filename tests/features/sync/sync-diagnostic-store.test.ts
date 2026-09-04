import {
  drainDiagnosticEvents,
  readDiagnosticEvents,
  recordDiagnosticEvent,
  resetDiagnosticEvents,
} from '../../../src/features/sync/sync-diagnostic-store';

describe('sync diagnostic store', () => {
  beforeEach(() => {
    resetDiagnosticEvents();
  });

  it('empieza vacío', () => {
    expect(readDiagnosticEvents()).toEqual([]);
  });

  it('registra una observación con su instante', () => {
    recordDiagnosticEvent({ source: 'websocket', event: 'ws_opened', at: 1710000000000 });

    expect(readDiagnosticEvents()).toEqual([
      {
        source: 'websocket',
        event: 'ws_opened',
        cause: null,
        firstAt: 1710000000000,
        lastAt: 1710000000000,
        count: 1,
      },
    ]);
  });

  it('coalesce repeticiones a través del store, no sólo del helper', () => {
    recordDiagnosticEvent({ source: 'websocket', event: 'ws_closed', at: 100 });
    recordDiagnosticEvent({ source: 'websocket', event: 'ws_closed', at: 900 });

    const events = readDiagnosticEvents();

    expect(events).toHaveLength(1);
    expect(events[0].count).toBe(2);
    expect(events[0].firstAt).toBe(100);
    expect(events[0].lastAt).toBe(900);
  });

  it('NUNCA lanza, aunque la observación venga corrupta', () => {
    // Es instrumentación: jamás puede ser la causa de que falle lo que está midiendo.
    expect(() =>
      recordDiagnosticEvent({ source: 'nope' as never, event: 'nope' as never, at: Number.NaN }),
    ).not.toThrow();
  });

  it('descarta observaciones fuera del vocabulario en vez de emitirlas', () => {
    recordDiagnosticEvent({ source: 'nope' as never, event: 'ws_opened', at: 1 });
    recordDiagnosticEvent({ source: 'websocket', event: 'nope' as never, at: 1 });

    expect(readDiagnosticEvents()).toEqual([]);
  });

  it('drain devuelve lo acumulado y deja el store vacío', () => {
    // Vaciar al drenar evita que un incidente viejo siga viajando en cada reconcile por el
    // resto del proceso, que convertiría el anillo en ruido permanente.
    recordDiagnosticEvent({ source: 'mutation', event: 'mutation_failed', at: 1 });

    const drained = drainDiagnosticEvents();

    expect(drained).toHaveLength(1);
    expect(readDiagnosticEvents()).toEqual([]);
  });
});
