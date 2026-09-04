import {
  buildSyncTelemetryPreferencePatch,
  isSyncTelemetryEnabled,
} from '../../../src/features/sync/sync-telemetry-preference.helpers';

describe('isSyncTelemetryEnabled', () => {
  it('respeta el apagado explícito del usuario', () => {
    expect(isSyncTelemetryEnabled({ isSyncTelemetryEnabled: false })).toBe(false);
  });

  it('respeta el encendido explícito del usuario', () => {
    expect(isSyncTelemetryEnabled({ isSyncTelemetryEnabled: true })).toBe(true);
  });

  it('vale true cuando la preferencia todavía no existe', () => {
    // Default encendido a propósito: un dispositivo que choca con la falla ANTES de que
    // alguien abra Settings igual tiene que poder reportarla. Un default apagado reproduce
    // exactamente la ceguera que esta telemetría existe para eliminar. El payload es
    // PII-free por construcción y viaja al bridge propio del usuario en su propia LAN.
    expect(isSyncTelemetryEnabled(null)).toBe(true);
    expect(isSyncTelemetryEnabled({})).toBe(true);
    expect(isSyncTelemetryEnabled({ isSyncTelemetryEnabled: undefined })).toBe(true);
    // NULL es AUSENCIA, no una elección: la columna es NOT NULL con default true, así que un
    // valor nulo sólo aparece en una fila anterior a la migración. Tratarlo como apagado
    // dejaría mudos en silencio a todos los dispositivos existentes, que es el bug que
    // esta telemetría viene a resolver.
    expect(isSyncTelemetryEnabled({ isSyncTelemetryEnabled: null })).toBe(true);
  });

  it('trata un valor no booleano como apagado en vez de adivinar', () => {
    // Basura no es ausencia: no se puede interpretar, así que se elige el lado conservador.
    expect(isSyncTelemetryEnabled({ isSyncTelemetryEnabled: 'yes' })).toBe(false);
    expect(isSyncTelemetryEnabled({ isSyncTelemetryEnabled: 0 })).toBe(false);
    expect(isSyncTelemetryEnabled({ isSyncTelemetryEnabled: 1 })).toBe(false);
  });
});

describe('buildSyncTelemetryPreferencePatch', () => {
  it('proyecta la elección del usuario a un patch de una sola columna', () => {
    expect(buildSyncTelemetryPreferencePatch(false)).toEqual({ isSyncTelemetryEnabled: false });
    expect(buildSyncTelemetryPreferencePatch(true)).toEqual({ isSyncTelemetryEnabled: true });
  });
});
