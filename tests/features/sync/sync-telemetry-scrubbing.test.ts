import { causeFromError } from '../../../src/features/sync/sync-telemetry.helpers';
import { SYNC_CYCLE_ERROR_CAUSES } from '../../../src/features/sync/sync-telemetry.constants';

// --- Endurecimiento de seguridad ---------------------------------------------------------
// team-bridge verificó contra el código real del bridge: los request bodies NO pasan por
// ningún sanitizador. Se guardan verbatim EN REPOSO, se copian con los backups y salen por
// MCP tal cual. En Android un `error.message` crudo arrastra rutas
// (/data/user/0/<pkg>/databases/...), fragmentos de SQL y valores bindeados.
// Solución: clasificar el mensaje EN CLIENTE y emitir únicamente un símbolo cerrado.

describe('causeFromError', () => {
  it('clasifica el handle cerrado desde un Error real, que es la falla medida en device', () => {
    const error = new Error(
      "Call to function 'NativeDatabase.execAsync' has been rejected. → Caused by: Access to closed resource",
    );

    expect(causeFromError(error)).toBe('closed_resource');
  });

  it('reconoce la contención de lock, que tiene un fix distinto', () => {
    expect(causeFromError(new Error('database is locked'))).toBe('lock_contention');
    expect(causeFromError(new Error('SQLITE_BUSY_SNAPSHOT'))).toBe('lock_contention');
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

  it('colapsa a unknown un Error que no reconoce, y NUNCA devuelve el mensaje', () => {
    const cause = causeFromError(new Error("UPDATE animes SET nombre = 'Bleach'"));

    expect(cause).toBe('unknown');
    expect(SYNC_CYCLE_ERROR_CAUSES).toContain(cause);
  });
});
