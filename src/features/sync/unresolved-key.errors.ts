import type { UnresolvedKeyRef, UnresolvedResolutionErrorCode } from './unresolved-key.types';

/**
 * The resolution entry point refused a request (ADR 009 R-16b). Nothing was written: the key is
 * exactly as unresolved as it was before the call.
 */
export class UnresolvedResolutionError extends Error {
  readonly code: UnresolvedResolutionErrorCode;
  readonly key: UnresolvedKeyRef;

  constructor(code: UnresolvedResolutionErrorCode, key: UnresolvedKeyRef) {
    super(`Unresolved key not resolved: ${code}`);
    this.name = 'UnresolvedResolutionError';
    this.code = code;
    this.key = key;
  }
}
