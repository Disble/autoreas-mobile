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
 * This isolates URL parsing so the hook only coordinates state updates and toast side effects.
 */
export function parseSetupDeepLink(url: string | null): BridgePairingPayload | null {
  if (!url) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const normalizedPath = parsedUrl.pathname.replace(/\/+$/, '');

    if (
      parsedUrl.protocol.replace(':', '') !== SETUP_DEEP_LINK_SCHEME ||
      parsedUrl.hostname !== SETUP_DEEP_LINK_HOST ||
      (normalizedPath !== '' && normalizedPath !== '/')
    ) {
      return null;
    }

    const params = new URLSearchParams(parsedUrl.search);
    const parsedPayload = SetupPairingPayloadSchema.safeParse({
      version: params.get('v'),
      ip: params.get('ip'),
      port: params.get('port'),
      token: params.get('token'),
    });

    return parsedPayload.success ? parsedPayload.data : null;
  } catch {
    return null;
  }
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
