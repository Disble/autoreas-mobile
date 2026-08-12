import type { LocalWriteFailureDiagnostics } from '../../infrastructure/db/client/client.types';
import { EXPO_SQLITE_UNAVAILABLE_MESSAGE } from '../../infrastructure/db/native-runtime/native-runtime.constants';
import {
  ANIME_MUTATION_FAILURE_LABEL,
  ANIME_MUTATION_FAILURE_MAX_MESSAGE_LENGTH,
  ANIME_MUTATION_FAILURE_UNKNOWN_REASON,
  ANIME_MUTATION_STORAGE_UNAVAILABLE_DESCRIPTION,
  ANIME_MUTATION_STORAGE_UNAVAILABLE_LABEL,
} from './anime-mutation-failure.constants';
import type { AnimeMutationFailureFeedback } from './anime-mutation.types';

/**
 * Reduces any thrown value to a single trimmed reason string.
 * Mutations reject with plain Errors, rejected strings, and (rarely) undefined, so the
 * normalization has to happen before either the toast or the persisted tile reads it.
 */
function toReasonOrUnknown(rawReason: string): string {
  const trimmedReason = rawReason.trim();

  return trimmedReason.length > 0 ? trimmedReason : ANIME_MUTATION_FAILURE_UNKNOWN_REASON;
}

function normalizeFailureReason(error: unknown): string {
  // Only Errors and thrown strings carry a reason a user can act on. Everything else (nullish
  // rejections, plain objects) would stringify to noise like "undefined" or "[object Object]",
  // which is worse than admitting the reason is unknown.
  if (error instanceof Error) {
    return toReasonOrUnknown(error.message);
  }

  if (typeof error === 'string') {
    return toReasonOrUnknown(error);
  }

  return ANIME_MUTATION_FAILURE_UNKNOWN_REASON;
}

/**
 * Clamps a failure string to the shared display bound, marking elision with an ellipsis.
 * Shared by the persisted message and the toast description so a long native payload cannot
 * overflow one surface while the other stays bounded.
 */
function truncateToMaxLength(value: string): string {
  if (value.length <= ANIME_MUTATION_FAILURE_MAX_MESSAGE_LENGTH) {
    return value;
  }

  return `${value.slice(0, ANIME_MUTATION_FAILURE_MAX_MESSAGE_LENGTH - 1)}…`;
}

/**
 * Recognizes a `LocalWriteError` by shape rather than `instanceof`. A type-only check keeps this
 * file decoupled from `client.helpers`'s concrete export at runtime, so a test that mocks that
 * module without re-exporting the class (most callers of `withDeferredWrite` do) still degrades
 * safely here instead of throwing on a missing constructor.
 */
function readLocalWriteFailureDiagnostics(error: unknown): LocalWriteFailureDiagnostics | null {
  if (typeof error !== 'object' || error === null) return null;
  if (!('errcode' in error) || !('elapsedMs' in error) || !('stage' in error)) return null;

  return error as LocalWriteFailureDiagnostics;
}

/**
 * Surfaces write-failure diagnostics (errcode/elapsedMs/stage) through console telemetry only.
 * This is deliberately separate from the returned copy: the persisted Settings message and the
 * toast must stay byte-identical to their pre-diagnostics rendering
 * (write-failure-diagnostics spec, "User-Facing Failure Copy Remains Unchanged").
 */
function logLocalWriteFailureDiagnostics(label: string, error: unknown): void {
  const diagnostics = readLocalWriteFailureDiagnostics(error);
  if (!diagnostics) return;

  console.warn(`[${label}] Local write failure diagnostics`, diagnostics);
}

/**
 * Builds the message persisted into the sync runtime status so Settings can show it.
 * The action label is prefixed because every chapter button funnels into the same channel and
 * the failing action is the first thing needed to tell a write failure from a sync failure.
 */
export function getAnimeMutationFailureMessage(label: string, error: unknown): string {
  logLocalWriteFailureDiagnostics(label, error);
  return truncateToMaxLength(`${label}: ${normalizeFailureReason(error)}`);
}

/**
 * Detects the "expo-sqlite is not available" rejection thrown when no database context exists.
 * That failure is not a write error and needs different user-facing copy.
 */
function isStorageUnavailableFailure(error: unknown): boolean {
  return normalizeFailureReason(error) === EXPO_SQLITE_UNAVAILABLE_MESSAGE;
}

/**
 * Builds the toast copy for a chapter mutation that never landed.
 * Surfacing the raw reason is deliberate: this failure used to be swallowed entirely, so the
 * button looked broken with no explanation anywhere in the app.
 */
export function buildAnimeMutationFailureFeedback(
  error: unknown,
): AnimeMutationFailureFeedback {
  if (isStorageUnavailableFailure(error)) {
    return {
      label: ANIME_MUTATION_STORAGE_UNAVAILABLE_LABEL,
      description: ANIME_MUTATION_STORAGE_UNAVAILABLE_DESCRIPTION,
    };
  }

  return {
    label: ANIME_MUTATION_FAILURE_LABEL,
    // Capped like the persisted message: a native error can carry a very long payload, and an
    // unbounded description would push the toast off screen.
    description: truncateToMaxLength(normalizeFailureReason(error)),
  };
}
