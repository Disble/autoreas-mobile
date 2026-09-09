import {
  buildSyncCycleTelemetry,
  causeFromError,
  classifySyncCycleErrorCause,
  fingerprintSyncCycleErrorName,
  normalizeNativeErrcodeByte,
  normalizeSyncCycleErrorName,
  normalizeSyncCycleErrorStage,
  normalizeSyncCycleStage,
  toWireSyncCycleTelemetry,
} from '../../../src/features/sync/sync-telemetry.helpers';
import { SYNC_CYCLE_ERROR_CAUSES } from '../../../src/features/sync/sync-telemetry.constants';
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
    lastDiagnosticsDiscardedCount: null,
    lastDiagnosticsFailedRemovalCount: null,
    lastOutboxFailedWriteCount: null,
    lastDeadLetterCount: null,
    lastConflictExhaustedCount: null,
    lastStuckProcessingCount: null,
    lastOldestPendingAgeMs: null,
    lastPendingRowCount: null,
    ...overrides,
  };
}

// --- Endurecimiento de seguridad ---------------------------------------------------------
// team-bridge verificó contra el código real del bridge: los request bodies NO pasan por
// ningún sanitizador. Se guardan verbatim EN REPOSO, se copian con los backups y salen por
// MCP tal cual. En Android un `error.message` crudo arrastra rutas
// (/data/user/0/<pkg>/databases/...), fragmentos de SQL y valores bindeados -- que en esta app
// son títulos de anime. Cada campo de texto que cruce el cable debe ser un enum cerrado.

describe('normalizeSyncCycleErrorName', () => {
  it('deja pasar los nombres de error del enum cerrado', () => {
    expect(normalizeSyncCycleErrorName('LocalWriteError')).toBe('LocalWriteError');
    expect(normalizeSyncCycleErrorName('BridgeTimeoutError')).toBe('BridgeTimeoutError');
  });

  it('colapsa a unknown cualquier texto libre en vez de dejarlo cruzar', () => {
    expect(normalizeSyncCycleErrorName('Cannot open database')).toBe('unknown');
  });

  it('NUNCA deja pasar un mensaje con ruta de archivo ni con datos de usuario', () => {
    // Este es el caso real observado en device: el mensaje arrastra la ruta de la DB.
    expect(
      normalizeSyncCycleErrorName(
        "Call to function 'NativeDatabase.execAsync' has been rejected. → Caused by: Access to closed resource",
      ),
    ).toBe('unknown');
    expect(
      normalizeSyncCycleErrorName('/data/user/0/com.disble.autoreasmobile/databases/anime.db'),
    ).toBe('unknown');
    expect(
      normalizeSyncCycleErrorName("UPDATE animes SET nombre = 'Bleach: Sennen Kessen-hen'"),
    ).toBe('unknown');
  });

  it('mantiene null cuando no hubo error', () => {
    expect(normalizeSyncCycleErrorName(null)).toBeNull();
    expect(normalizeSyncCycleErrorName(undefined)).toBeNull();
  });
});

describe('normalizeNativeErrcodeByte', () => {
  it('acepta el código numérico que realmente produce el runtime', () => {
    // `LocalWriteFailureDiagnostics.errcode` es `number | null`, no un string `SQLITE_*`:
    // `parseSqliteErrcode` devuelve el charCode del byte de control del mensaje nativo.
    // Un número no puede expresar PII de ninguna forma, así que es más seguro que un regex.
    expect(normalizeNativeErrcodeByte(5)).toBe(5);
    expect(normalizeNativeErrcodeByte(0)).toBe(0);
  });

  it('descarta lo que no sea un entero acotado', () => {
    expect(normalizeNativeErrcodeByte('SQLITE_BUSY')).toBeNull();
    expect(normalizeNativeErrcodeByte('database is locked')).toBeNull();
    expect(normalizeNativeErrcodeByte(-1)).toBeNull();
    expect(normalizeNativeErrcodeByte(70000)).toBeNull();
    expect(normalizeNativeErrcodeByte(1.5)).toBeNull();
    expect(normalizeNativeErrcodeByte(Number.NaN)).toBeNull();
    expect(normalizeNativeErrcodeByte(null)).toBeNull();
  });
});

describe('normalizeSyncCycleErrorStage y normalizeSyncCycleStage', () => {
  it('cubre cada stage que el runtime puede producir', () => {
    // El vocabulario tiene que ser el de `LocalWriteFailureStage`, no uno inventado. Un
    // allowlist que no contiene los valores interesantes no filtra: ciega.
    expect(normalizeSyncCycleErrorStage('begin')).toBe('begin');
    expect(normalizeSyncCycleErrorStage('task')).toBe('task');
    expect(normalizeSyncCycleErrorStage('commit')).toBe('commit');
    expect(normalizeSyncCycleErrorStage('rollback')).toBe('rollback');
    expect(normalizeSyncCycleErrorStage('deadline')).toBe('deadline');
  });

  it('colapsa lo desconocido y mantiene la ausencia', () => {
    expect(normalizeSyncCycleErrorStage('Bleach: Sennen Kessen-hen')).toBe('unknown');
    expect(normalizeSyncCycleErrorStage(null)).toBeNull();
  });

  it('sanea un last_stage corrompido en la columna de texto', () => {
    expect(normalizeSyncCycleStage('apply_write')).toBe('apply_write');
    expect(normalizeSyncCycleStage('/data/user/0/pkg')).toBeNull();
    expect(normalizeSyncCycleStage(null)).toBeNull();
  });

  it('distingue los dos writes que siguen a config en vez de plegarlos ahí', () => {
    // `recordSyncAttemptStarted` y `recordCycleActive(true)` son escrituras awaited por la
    // puerta compartida. Con la puerta trabada desde un ciclo anterior, el ciclo muere en UNA
    // de ellas. Plegarlas en `config` culparía a una lectura que sí completó.
    expect(normalizeSyncCycleStage('attempt_started')).toBe('attempt_started');
    expect(normalizeSyncCycleStage('cycle_activated')).toBe('cycle_activated');
  });
});

// --- Causa canónica del error ------------------------------------------------------------
// Hueco encontrado por team-bridge: `LocalWriteError` + errcode null + stage `begin` es la
// firma de un handle cerrado Y la de una contención de lock por igual. El nombre de clase
// solo NO distingue las dos, y distinguirlas era la razón declarada del triple de error --
// tienen fixes distintos. La señal vive en el mensaje, y el mensaje no puede cruzar el cable.
// Solución: clasificar el mensaje EN CLIENTE y emitir únicamente un símbolo cerrado.

describe('classifySyncCycleErrorCause', () => {
  it('reconoce el handle cerrado, que es la falla medida en device', () => {
    expect(
      classifySyncCycleErrorCause(
        "Call to function 'NativeDatabase.execAsync' has been rejected. → Caused by: Access to closed resource",
      ),
    ).toBe('closed_resource');
  });

  it('reconoce la contención de lock, que tiene un fix distinto', () => {
    expect(classifySyncCycleErrorCause('database is locked')).toBe('lock_contention');
    expect(classifySyncCycleErrorCause('SQLITE_BUSY_SNAPSHOT')).toBe('lock_contention');
  });

  it('reconoce timeout de bridge', () => {
    expect(
      classifySyncCycleErrorCause('Bridge request to http://x:9876/api/animes exceeded 10000ms'),
    ).toBe('timeout');
  });

  it('colapsa a unknown lo que no reconoce, y NUNCA devuelve el mensaje', () => {
    const cause = classifySyncCycleErrorCause("UPDATE animes SET nombre = 'Bleach'");

    expect(cause).toBe('unknown');
    expect(SYNC_CYCLE_ERROR_CAUSES).toContain(cause);
  });

  it('mantiene null cuando no hubo mensaje', () => {
    expect(classifySyncCycleErrorCause(null)).toBeNull();
    expect(classifySyncCycleErrorCause(undefined)).toBeNull();
  });
});

describe('fingerprintSyncCycleErrorName', () => {
  it('no huellea una clase que ya tiene símbolo propio', () => {
    expect(fingerprintSyncCycleErrorName('LocalWriteError')).toBeNull();
  });

  it('huellea una clase desconocida de forma estable y acotada', () => {
    const first = fingerprintSyncCycleErrorName('SomeUnmappedNativeError');

    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprintSyncCycleErrorName('SomeUnmappedNativeError')).toBe(first);
    expect(fingerprintSyncCycleErrorName('AnotherUnmappedError')).not.toBe(first);
  });

  it('RECHAZA huellear cualquier cosa que no sea un identificador de código', () => {
    // Huellear un mensaje reintroduciría el título de anime por diccionario. La forma de
    // identificador es la barrera estructural: un mensaje, una ruta o un título no la cumplen.
    expect(fingerprintSyncCycleErrorName('Access to closed resource')).toBeNull();
    expect(fingerprintSyncCycleErrorName('/data/user/0/pkg/databases/anime.db')).toBeNull();
    expect(fingerprintSyncCycleErrorName('Bleach: Sennen Kessen-hen')).toBeNull();
    expect(fingerprintSyncCycleErrorName(null)).toBeNull();
  });
});

describe('causa y huella en el payload del cable', () => {
  it('proyecta la causa canónica sin filtrar el mensaje crudo', () => {
    const wire = toWireSyncCycleTelemetry(
      buildSyncCycleTelemetry({
        cycleId: 'cycle-2',
        triggerSource: 'background_task',
        appState: 'background',
        snapshot: buildSnapshot({
          lastAttemptAt: 1710000000000,
          isCycleActive: true,
          lastErrorName: 'LocalWriteError',
          lastErrorStage: 'begin',
          lastFailureMessage:
            "Call to function 'NativeDatabase.execAsync' has been rejected. → Caused by: Access to closed resource",
        }),
        pendingOpsCount: 1,
        cursor: 2259,
        now: 1710000600000,
      }),
    );

    expect(wire.previous_cycle?.error_cause).toBe('closed_resource');
    expect(JSON.stringify(wire)).not.toContain('NativeDatabase');
    expect(JSON.stringify(wire)).not.toContain('Access to closed resource');
  });
});

describe('causeFromError', () => {
  it('clasifica el handle cerrado desde un Error real', () => {
    const error = new Error(
      "Call to function 'NativeDatabase.execAsync' has been rejected. → Caused by: Access to closed resource",
    );

    expect(causeFromError(error)).toBe('closed_resource');
  });

  it('clasifica un timeout de bridge', () => {
    expect(causeFromError(new Error('Bridge request to http://x/api exceeded 10000ms'))).toBe(
      'timeout',
    );
  });

  it('devuelve null ante un throw que no es Error, en vez de stringificarlo', () => {
    // `String(value)` sobre un objeto arbitrario es justo el texto libre que este contrato
    // existe para mantener fuera del cable.
    expect(causeFromError({ titulo: 'Bleach: Sennen Kessen-hen' })).toBeNull();
    expect(causeFromError(null)).toBeNull();
  });

  it('colapsa a unknown un Error que no reconoce, sin filtrar su mensaje', () => {
    const cause = causeFromError(new Error("UPDATE animes SET nombre = 'Bleach'"));

    expect(cause).toBe('unknown');
  });
});
