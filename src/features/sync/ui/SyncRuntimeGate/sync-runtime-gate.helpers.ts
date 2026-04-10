import { SyncRuntimeGateDefaultLabel } from './sync-runtime-gate.constants';

/**
 * Resolves the optional scaffold label for the runtime gate.
 * The real gate is renderless, but the helper keeps fallback behavior testable.
 */
export function getSyncRuntimeGateLabel(label?: string | null) {
  return label ?? SyncRuntimeGateDefaultLabel;
}
