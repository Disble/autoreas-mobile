import type { SetupScreenFormState } from './setup-screen.types';

/**
 * Parses a pairing deep link and extracts form values when the URL matches the app contract.
 * This isolates URL parsing so the hook only coordinates state updates and toast side effects.
 */
export function parseSetupDeepLink(url: string | null): Partial<SetupScreenFormState> | null {
  if (!url) {
    return null;
  }

  const parsedUrl = new URL(url);

  if (parsedUrl.protocol.replace(':', '') !== 'autoreas' || parsedUrl.hostname !== 'pair') {
    return null;
  }

  const params = new URLSearchParams(parsedUrl.search);

  return {
    ip: params.get('ip') ?? undefined,
    port: params.get('port') ?? undefined,
    token: params.get('token') ?? undefined,
  };
}

/**
 * Validates the setup form and returns the user-facing message for the first invalid state.
 * Keeping this pure prevents the hook from duplicating toast copy across submit branches.
 */
export function getSetupValidationMessage(
  formState: SetupScreenFormState,
): string | null {
  if (!formState.ip || !formState.port || !formState.token) {
    return 'Todos los campos son obligatorios.';
  }

  if (Number.isNaN(Number.parseInt(formState.port, 10))) {
    return 'El puerto debe ser un número válido.';
  }

  return null;
}
