import {
  buildSyncCycleTelemetry,
  capWireSyncCycleTelemetry,
  derivePreviousCycleOutcome,
  resolveClientTelemetry,
  toWireSyncCycleTelemetry,
} from '../../../src/features/sync/sync-telemetry.helpers';
import type { SyncRuntimeStatusSnapshot } from '../../../src/features/sync/sync-runtime-status.types';

/** Builds a neutral runtime snapshot so each test only states the fields it actually exercises. */
function buildSnapshot(
  overrides: Partial<SyncRuntimeStatusSnapshot> = {},
): SyncRuntimeStatusSnapshot {
  return {
    registrationStatus: 'registered',
    executionMode: 'best_effort_background_task',
    isForegroundServiceRunning: false,
    canShowPersistentNotification: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureMessage: null,
    lastTriggerSource: null,
    lastSyncedCount: 0,
    isCycleActive: false,
    lastBacklogReadCount: 0,
    lastPrunedOperationsCount: 0,
    isBackgroundTaskRegistered: false,
    lastCycleId: null,
    lastCycleStage: null,
    lastErrorName: null,
    lastNativeErrcodeByte: null,
    lastErrorStage: null,
    consecutiveUnclosedCycles: 0,
    lastCycleStageAt: null,
    lastFailedCheckpointCount: 0,
    ...overrides,
  };
}

describe('derivePreviousCycleOutcome', () => {
  it('reporta never_closed cuando el ciclo anterior quedó activo', () => {
    // Un ciclo matado por el SO nunca corre su `finally`, así que `isCycleActive`
    // queda pegado en true. Esa es la unica senal que un proceso muerto deja atras.
    const snapshot = buildSnapshot({ lastAttemptAt: 1710000000000, isCycleActive: true });

    expect(derivePreviousCycleOutcome(snapshot)).toBe('never_closed');
  });

  it('never_closed gana sobre failed cuando ambas senales coexisten', () => {
    // Un ciclo puede registrar un fallo y ser matado inmediatamente despues, antes
    // de liberar el flag. El kill es el hecho mas grave y debe ganar la precedencia.
    const snapshot = buildSnapshot({
      lastAttemptAt: 1710000000000,
      isCycleActive: true,
      lastFailureMessage: 'Bridge config is missing or incomplete',
    });

    expect(derivePreviousCycleOutcome(snapshot)).toBe('never_closed');
  });

  it('reporta failed cuando el ciclo cerró con un mensaje de error', () => {
    const snapshot = buildSnapshot({
      lastAttemptAt: 1710000000000,
      isCycleActive: false,
      lastFailureMessage: 'Reconcile failed: 500',
    });

    expect(derivePreviousCycleOutcome(snapshot)).toBe('failed');
  });

  it('reporta completed cuando el ciclo cerró limpio', () => {
    const snapshot = buildSnapshot({
      lastAttemptAt: 1710000000000,
      lastSuccessAt: 1710000000500,
      isCycleActive: false,
    });

    expect(derivePreviousCycleOutcome(snapshot)).toBe('completed');
  });

  it('devuelve null cuando nunca hubo un ciclo previo', () => {
    expect(derivePreviousCycleOutcome(buildSnapshot())).toBeNull();
  });
});

describe('buildSyncCycleTelemetry', () => {
  it('omite previousCycle cuando no hay historial', () => {
    const telemetry = buildSyncCycleTelemetry({
      cycleId: 'cycle-1',
      triggerSource: 'background_task',
      appState: 'background',
      snapshot: buildSnapshot(),
      pendingOpsCount: 0,
      cursor: 0,
    });

    expect(telemetry.previousCycle).toBeNull();
    expect(telemetry.cycleId).toBe('cycle-1');
    expect(telemetry.triggerSource).toBe('background_task');
    expect(telemetry.appState).toBe('background');
  });

  it('proyecta el ciclo anterior matado con su tramo y su error estructurado', () => {
    const telemetry = buildSyncCycleTelemetry({
      cycleId: 'cycle-2',
      triggerSource: 'background_task',
      appState: 'background',
      snapshot: buildSnapshot({
        lastAttemptAt: 1710000000000,
        isCycleActive: true,
        lastCycleId: 'cycle-1',
        lastTriggerSource: 'background_task',
        lastCycleStage: 'apply_write',
        lastErrorName: 'LocalWriteError',
        lastNativeErrcodeByte: null,
        lastErrorStage: 'begin',
        consecutiveUnclosedCycles: 5,
      }),
      pendingOpsCount: 1,
      cursor: 2259,
      now: 1710000600000,
    });

    expect(telemetry.previousCycle).toEqual({
      cycleId: 'cycle-1',
      triggerSource: 'background_task',
      outcome: 'never_closed',
      lastStage: 'apply_write',
      startedAt: 1710000000000,
      elapsedMs: 600000,
      errorName: 'LocalWriteError',
      nativeErrcodeByte: null,
      errorStage: 'begin',
      errorCause: null,
      errorFingerprint: null,
    });
    expect(telemetry.counters).toEqual({
      consecutiveUnclosedCycles: 5,
      pendingOpsCount: 1,
      cursor: 2259,
    });
  });

  it('deja elapsedMs en null cuando no puede calcularlo', () => {
    const telemetry = buildSyncCycleTelemetry({
      cycleId: 'cycle-3',
      triggerSource: 'manual',
      appState: 'foreground',
      snapshot: buildSnapshot({ lastAttemptAt: 1710000000000, isCycleActive: true }),
      pendingOpsCount: 0,
      cursor: 10,
    });

    expect(telemetry.previousCycle?.elapsedMs).toBeNull();
  });

  it('nunca deja elapsedMs negativo si el reloj retrocede', () => {
    const telemetry = buildSyncCycleTelemetry({
      cycleId: 'cycle-4',
      triggerSource: 'background_task',
      appState: 'background',
      snapshot: buildSnapshot({ lastAttemptAt: 1710000600000, isCycleActive: true }),
      pendingOpsCount: 0,
      cursor: 10,
      now: 1710000000000,
    });

    expect(telemetry.previousCycle?.elapsedMs).toBe(0);
  });
});

describe('toWireSyncCycleTelemetry', () => {
  it('serializa a snake_case sin filtrar campos ajenos al contrato', () => {
    const wire = toWireSyncCycleTelemetry(
      buildSyncCycleTelemetry({
        cycleId: 'cycle-2',
        triggerSource: 'background_task',
        appState: 'background',
        snapshot: buildSnapshot({
          lastAttemptAt: 1710000000000,
          isCycleActive: true,
          lastCycleId: 'cycle-1',
          lastTriggerSource: 'foreground_service',
          lastCycleStage: 'http',
          lastErrorName: 'LocalWriteError',
          lastNativeErrcodeByte: 5,
          lastErrorStage: 'begin',
          consecutiveUnclosedCycles: 2,
        }),
        pendingOpsCount: 3,
        cursor: 2259,
        now: 1710000010000,
      }),
    );

    expect(wire).toEqual({
      cycle_id: 'cycle-2',
      trigger_source: 'background_task',
      app_state: 'background',
      previous_cycle: {
        cycle_id: 'cycle-1',
        trigger_source: 'foreground_service',
        outcome: 'never_closed',
        last_stage: 'http',
        started_at: 1710000000000,
        elapsed_ms: 10000,
        error_name: 'LocalWriteError',
        native_errcode_byte: 5,
        error_stage: 'begin',
        error_cause: null,
        error_fingerprint: null,
      },
      counters: {
        consecutive_unclosed_cycles: 2,
        pending_ops_count: 3,
        cursor: 2259,
      },
      recent_events: [],
    });
  });

  it('emite previous_cycle nulo cuando no hay historial', () => {
    const wire = toWireSyncCycleTelemetry(
      buildSyncCycleTelemetry({
        cycleId: 'cycle-1',
        triggerSource: 'bootstrap',
        appState: 'foreground',
        snapshot: buildSnapshot(),
        pendingOpsCount: 0,
        cursor: 0,
      }),
    );

    expect(wire.previous_cycle).toBeNull();
  });
});

describe('capWireSyncCycleTelemetry', () => {
  function buildWire() {
    return toWireSyncCycleTelemetry(
      buildSyncCycleTelemetry({
        cycleId: 'cycle-2',
        triggerSource: 'background_task',
        appState: 'background',
        snapshot: buildSnapshot({
          lastAttemptAt: 1710000000000,
          isCycleActive: true,
          lastCycleId: 'cycle-1',
          lastTriggerSource: 'background_task',
          lastCycleStage: 'apply_write',
          lastErrorName: 'LocalWriteError',
          lastNativeErrcodeByte: 5,
          lastErrorStage: 'begin',
          consecutiveUnclosedCycles: 5,
        }),
        pendingOpsCount: 1,
        cursor: 2259,
        now: 1710000600000,
      }),
    );
  }

  it('deja pasar intacto un payload dentro del presupuesto', () => {
    const wire = buildWire();

    expect(capWireSyncCycleTelemetry(wire)).toEqual(wire);
  });

  it('degrada soltando primero los campos de error del ciclo previo', () => {
    // El presupuesto se DERIVA del payload en vez de hardcodearse: un byte menos que el
    // tamano completo fuerza exactamente un escalon de degradacion, y el test deja de
    // romperse cada vez que el contrato gana o pierde un campo.
    const wire = buildWire();
    const capped = capWireSyncCycleTelemetry(wire, JSON.stringify(wire).length - 1);

    expect(capped?.previous_cycle?.error_name).toBeNull();
    expect(capped?.previous_cycle?.native_errcode_byte).toBeNull();
    expect(capped?.previous_cycle?.error_stage).toBeNull();
    // El tramo y el desenlace son la razón de ser de la telemetría: sobreviven al recorte.
    expect(capped?.previous_cycle?.outcome).toBe('never_closed');
    expect(capped?.previous_cycle?.last_stage).toBe('apply_write');
  });

  it('suelta el ciclo previo entero antes que romper el presupuesto', () => {
    // 220 entra justo para el payload sin ciclo previo (~204 B con el anillo ya vacío) y no
    // para el que lo conserva, así que fuerza el segundo escalón y no el tercero.
    const capped = capWireSyncCycleTelemetry(buildWire(), 220);

    expect(capped?.previous_cycle).toBeNull();
    expect(capped?.counters.consecutive_unclosed_cycles).toBe(5);
  });

  it('devuelve null antes que mandar algo que reviente el presupuesto', () => {
    // Un body que pasa los 64 KiB hace que el bridge descarte la captura EN SILENCIO y se
    // lleve puesta la captura del payload de reconcile que ya usamos. Mandar nada es mejor.
    expect(capWireSyncCycleTelemetry(buildWire(), 10)).toBeNull();
  });
});

// --- Puerta única de salida --------------------------------------------------------------
// Preferencia del usuario, presupuesto y serialización convergen en UN solo punto. Ponerlo
// acá y no en cada llamador es lo que hace que el switch sea una garantía y no una convención:
// no existe un camino al cable que lo saltee.

describe('resolveClientTelemetry', () => {
  const telemetry = buildSyncCycleTelemetry({
    cycleId: 'cycle-2',
    triggerSource: 'background_task',
    appState: 'background',
    snapshot: buildSnapshot({ lastAttemptAt: 1710000000000, isCycleActive: true }),
    pendingOpsCount: 1,
    cursor: 2259,
    now: 1710000600000,
  });

  it('no emite nada cuando el usuario apagó el envío', () => {
    expect(resolveClientTelemetry(telemetry, { isSyncTelemetryEnabled: false })).toBeNull();
  });

  it('emite cuando el usuario lo tiene encendido', () => {
    const wire = resolveClientTelemetry(telemetry, { isSyncTelemetryEnabled: true });

    expect(wire?.cycle_id).toBe('cycle-2');
    expect(wire?.previous_cycle?.outcome).toBe('never_closed');
  });

  it('emite cuando la preferencia todavía no existe, respetando el default', () => {
    expect(resolveClientTelemetry(telemetry, null)?.cycle_id).toBe('cycle-2');
  });

  it('no emite nada cuando no hay telemetría que mandar', () => {
    expect(resolveClientTelemetry(undefined, { isSyncTelemetryEnabled: true })).toBeNull();
  });

  it('aplica el presupuesto en el mismo paso', () => {
    // El cap no puede quedar como responsabilidad del llamador: si se puede olvidar, se olvida.
    expect(resolveClientTelemetry(telemetry, null, 10)).toBeNull();
  });
});

// --- Eventos de diagnóstico en el payload -------------------------------------------------
// El post-mortem del ciclo contesta "¿murió y dónde?". El anillo de eventos contesta "¿qué más
// está pasando?" -- WebSocket, mutaciones, resync de foreground, registro del headless task.
// Ninguno de esos vive dentro de un ciclo, así que sin el anillo siguen requiriendo cable.

describe('eventos de diagnóstico en el payload', () => {
  const events = [
    {
      source: 'websocket' as const,
      event: 'ws_closed' as const,
      cause: null,
      firstAt: 100,
      lastAt: 900,
      count: 4,
    },
  ];

  it('viajan junto al post-mortem del ciclo', () => {
    const wire = toWireSyncCycleTelemetry(
      buildSyncCycleTelemetry({
        cycleId: 'cycle-2',
        triggerSource: 'background_task',
        appState: 'background',
        snapshot: buildSnapshot({ lastAttemptAt: 1710000000000, isCycleActive: true }),
        pendingOpsCount: 0,
        cursor: 2259,
        recentEvents: events,
      }),
    );

    expect(wire.recent_events).toEqual([
      { source: 'websocket', event: 'ws_closed', cause: null, first_at: 100, last_at: 900, count: 4 },
    ]);
  });

  it('emite lista vacía cuando no hay eventos', () => {
    const wire = toWireSyncCycleTelemetry(
      buildSyncCycleTelemetry({
        cycleId: 'cycle-1',
        triggerSource: 'manual',
        appState: 'foreground',
        snapshot: buildSnapshot(),
        pendingOpsCount: 0,
        cursor: 0,
      }),
    );

    expect(wire.recent_events).toEqual([]);
  });

  it('los eventos son lo PRIMERO que se suelta bajo presupuesto', () => {
    // Son la parte de tamaño variable, y bajo presión el diagnóstico puntual del ciclo vale
    // más que el patrón: `outcome` y `last_stage` tienen que sobrevivir más que ellos.
    const wire = toWireSyncCycleTelemetry(
      buildSyncCycleTelemetry({
        cycleId: 'cycle-2',
        triggerSource: 'background_task',
        appState: 'background',
        snapshot: buildSnapshot({ lastAttemptAt: 1710000000000, isCycleActive: true }),
        pendingOpsCount: 0,
        cursor: 2259,
        recentEvents: events,
      }),
    );
    const capped = capWireSyncCycleTelemetry(wire, JSON.stringify(wire).length - 1);

    expect(capped?.recent_events).toEqual([]);
    expect(capped?.previous_cycle?.outcome).toBe('never_closed');
  });
});
