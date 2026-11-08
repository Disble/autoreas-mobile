import { getBridgeConfigSnapshot } from '../../infrastructure/db/client/client.helpers';
import { createNativeSyncDiary } from './native-sync-diary.helpers';
import { isSyncDiagnosticsPayloadAccepted } from './sync-diagnostics-flush.helpers';
import type {
  RecordNetworkTransitionDeps,
  RecordNetworkTransitionInput,
  SyncRuntimeNetworkTransition,
} from './sync-runtime-network.types';
import { isSyncTelemetryEnabled } from './sync-telemetry-preference.helpers';

/**
 * The diary's name for a connectivity change, or `null` when nothing changed
 * (odd/tasks/mobile-report-kinds.md S4). The first reading after the listener starts is not a
 * change: there is nothing it changed from.
 */
export function resolveNetworkTransition(
  previous: boolean | null,
  isConnected: boolean,
): SyncRuntimeNetworkTransition | null {
  if (previous === null || previous === isConnected) {
    return null;
  }

  return isConnected ? 'started' : 'stopped';
}

/**
 * Reports one connectivity change as a main-process `network` runtime transition in the native
 * sync diary. Gated like the attempt recorder (`recordForegroundSyncAttempt`): no database or an
 * unreadable config records nothing, the user's switch off records nothing, and neither does a
 * bridge that does not accept `runtime_transition`. Never rejects and never throws.
 */
export async function recordNetworkTransition(
  input: RecordNetworkTransitionInput,
  deps: RecordNetworkTransitionDeps = {},
): Promise<void> {
  try {
    if (input.rawDb === null) {
      return;
    }

    const config = await (deps.readConfig ?? getBridgeConfigSnapshot)(input.rawDb);
    if (!isSyncTelemetryEnabled(config)) {
      return;
    }

    const isAccepted = deps.isAccepted ?? isSyncDiagnosticsPayloadAccepted;
    if (!isAccepted({ kind: 'runtime_transition' })) {
      return;
    }

    (deps.diary ?? createNativeSyncDiary()).recordRuntimeTransition('network', input.transition);
  } catch {
    // Swallowed by contract: see the function doc.
  }
}
