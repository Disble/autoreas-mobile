import type { PairResponse } from './pair-device.types';

/**
 * Detects which mandatory fields are missing from the pair response payload.
 * Validation must stay explicit so the pairing flow rejects incomplete contracts before persisting config.
 */
export function getMissingPairResponseFields(
  response: Partial<PairResponse>,
): readonly string[] {
  const missingFields: string[] = [];

  if (!response.device_id) {
    missingFields.push('device_id');
  }

  if (!response.auth_token) {
    missingFields.push('auth_token');
  }

  return missingFields;
}

/**
 * Builds the friendly error shown when `/api/devices/pair` rejects the request.
 * This keeps the UI actionable without leaking raw backend diagnostics to end users.
 */
export function buildPairRequestFailureMessage(params: {
  readonly status?: number | null;
}): string {
  if (params.status === 401) {
    return 'No pudimos emparejar el dispositivo. Verificá o regenerá el token del Bridge e intentá de nuevo.';
  }

  return 'No pudimos emparejar el dispositivo. Revisá la IP, el puerto y el token del Bridge.';
}

/**
 * Builds the friendly error shown when the pair endpoint returns an incomplete success payload.
 * The app still validates the contract strictly, but the UI copy stays short and understandable.
 */
export function buildPairResponseValidationFailureMessage(params: {
  readonly missingFields?: readonly string[];
}): string {
  if (params.missingFields?.includes('auth_token')) {
    return 'El Bridge respondió con datos incompletos. Volvé a generar el token e intentá de nuevo.';
  }

  return 'El Bridge respondió con datos incompletos. Intentá emparejar nuevamente.';
}

/**
 * Extracts an HTTP status code from an upstream error message when one is present.
 * Initial sync currently throws string messages, so parsing preserves the status without changing the sync layer contract.
 */
export function extractHttpStatusFromErrorMessage(message: string): number | null {
  const matchedStatus = message.match(/:\s*(\d{3})(?:\D|$)/);

  if (!matchedStatus) {
    return null;
  }

  return Number(matchedStatus[1]);
}

/**
 * Builds the friendly error shown when `/api/animes` fails after a successful pair response.
 * Pairing still aborts before persistence, but the user sees guidance instead of contract-level diagnostics.
 */
export function buildInitialSyncFailureMessage(params: {
  readonly cause: string;
}): string {
  const status = extractHttpStatusFromErrorMessage(params.cause);

  if (status === 401) {
    return 'Se completó el emparejamiento, pero el Bridge rechazó la sincronización inicial. Volvé a generar el token e intentá de nuevo.';
  }

  return 'Se completó el emparejamiento, pero falló la sincronización inicial. Intentá nuevamente en unos segundos.';
}
