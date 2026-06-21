import type { PairParams } from '../../pair-device.types';
import {
  SETUP_AUTOFILL_DESCRIPTION,
  SETUP_DEEP_LINK_DETECTED_LABEL,
  SETUP_DEEP_LINK_HOST,
  SETUP_DEEP_LINK_SCHEME,
  SETUP_INVALID_PAYLOAD_DESCRIPTION,
  SETUP_INVALID_PAYLOAD_LABEL,
  SETUP_QR_DETECTED_LABEL,
} from './setup-screen.constants';
import { SetupPairingPayloadSchema, SetupScreenFormSchema } from './setup-screen.schema';
import type {
  BridgePairingPayload,
  SetupPairingSource,
  SetupScreenFormState,
  SetupSourceFeedback,
} from './setup-screen.types';

/**
 * Parses a pairing deep link and extracts form values when the URL matches the app contract.
 * Intentionally avoids the global `URL` host/path getters: React Native's `URL` polyfill
 * (and `expo-linking`'s `parse`, which wraps it) only implements `hostname`/`pathname` for
 * `http(s)` schemes, so for the custom `autoreas-mobile://` scheme they return empty and the
 * `pair` host becomes invisible — which silently breaks QR/deep-link pairing in the app while
 * Node's spec-compliant URL keeps unit tests green. We match the scheme + host as a literal
 * prefix and read the query via `URLSearchParams`, which is scheme-agnostic and behaves
 * identically in Hermes and Node.
 */
export function parseSetupDeepLink(url: string | null): BridgePairingPayload | null {
  if (!url) {
    return null;
  }

  const trimmedUrl = url.trim();
  const canonicalPrefix = `${SETUP_DEEP_LINK_SCHEME}://${SETUP_DEEP_LINK_HOST}`;

  if (!trimmedUrl.startsWith(canonicalPrefix)) {
    return null;
  }

  const remainder = trimmedUrl.slice(canonicalPrefix.length);
  const queryIndex = remainder.indexOf('?');
  const pathSegment = queryIndex === -1 ? remainder : remainder.slice(0, queryIndex);

  if (pathSegment !== '' && pathSegment !== '/') {
    return null;
  }

  const queryString = queryIndex === -1 ? '' : remainder.slice(queryIndex + 1).split('#')[0];
  const params = new URLSearchParams(queryString);
  const parsedPayload = SetupPairingPayloadSchema.safeParse({
    version: params.get('v'),
    ip: params.get('ip'),
    port: params.get('port'),
    token: params.get('token'),
  });

  return parsedPayload.success ? parsedPayload.data : null;
}

/**
 * Converts a canonical pairing payload into the editable form state used by the setup screen.
 * This keeps QR and deep-link entry points aligned with the manual fallback fields.
 */
export function getSetupFormStateFromPayload(
  payload: BridgePairingPayload,
): SetupScreenFormState {
  return {
    ip: payload.ip,
    port: payload.port,
    token: payload.token,
  };
}

/**
 * Maps a valid setup form state into the shared pairing params contract.
 * This ensures manual entry, deep links, and QR scans all submit through the same pipeline.
 */
export function buildSetupPairParams(formState: SetupScreenFormState): PairParams {
  return {
    ip: formState.ip,
    port: Number.parseInt(formState.port, 10),
    token: formState.token,
  };
}

/**
 * Resolves the toast copy used after QR or deep-link autofill.
 * Centralizing these labels keeps entry-point feedback consistent across setup flows.
 */
export function getSetupSourceFeedback(
  source: Exclude<SetupPairingSource, 'manual'>,
): SetupSourceFeedback {
  return {
    label: source === 'qr' ? SETUP_QR_DETECTED_LABEL : SETUP_DEEP_LINK_DETECTED_LABEL,
    description: SETUP_AUTOFILL_DESCRIPTION,
  };
}

/**
 * Returns the warning toast copy for invalid QR or deep-link payloads.
 * This preserves manual fallback while still explaining why auto-submit did not happen.
 */
export function getInvalidSetupPayloadFeedback(): SetupSourceFeedback {
  return {
    label: SETUP_INVALID_PAYLOAD_LABEL,
    description: SETUP_INVALID_PAYLOAD_DESCRIPTION,
  };
}

/**
 * Validates the setup form and returns the user-facing message for the first invalid state.
 * Keeping this pure prevents the hook from duplicating toast copy across submit branches.
 */
export function getSetupValidationMessage(
  formState: SetupScreenFormState,
): string | null {
  const normalizedFormState = {
    ip: formState.ip.trim(),
    port: formState.port.trim(),
    token: formState.token.trim(),
  };

  if (!normalizedFormState.ip || !normalizedFormState.port || !normalizedFormState.token) {
    return 'Todos los campos son obligatorios.';
  }

  const parsedForm = SetupScreenFormSchema.safeParse(normalizedFormState);

  if (parsedForm.success) {
    return null;
  }

  if (!/^\d+$/.test(normalizedFormState.port)) {
    return 'El puerto debe ser un número válido.';
  }

  return 'El puerto debe estar entre 1 y 65535.';
}
