import { getBridgeConfigSnapshot } from '../../infrastructure/db/client/client.helpers';
import { createNativeSyncDiary } from './native-sync-diary.helpers';
import { SYNC_ATTEMPT_DIARY_SUMMARY_KIND } from './sync-attempt-diary.constants';
import type {
  RecordForegroundSyncAttemptDeps,
  RecordForegroundSyncAttemptInput,
} from './sync-attempt-diary.types';
import { isSyncDiagnosticsPayloadAccepted } from './sync-diagnostics-flush.helpers';
import { isSyncTelemetryEnabled } from './sync-telemetry-preference.helpers';

/**
 * Counts one finished JS sync attempt in the native sync diary (odd/tasks/mobile-report-kinds.md
 * T2, S3), which reports it in the `hourly_summary` of the hour it ended in.
 *
 * Gated like every other diagnostics producer: first on the user's switch, read from the bridge
 * config (a row that predates the switch means enabled, an unreadable config means nothing is
 * recorded), then on the bridge accepting `hourly_summary`. Never rejects and never throws: the
 * caller fires it and forgets it, so a diary failure cannot change the attempt it describes.
 */
export async function recordForegroundSyncAttempt(
  input: RecordForegroundSyncAttemptInput,
  deps: RecordForegroundSyncAttemptDeps = {},
): Promise<void> {
  try {
    const config = await (deps.readConfig ?? getBridgeConfigSnapshot)(input.rawDb);
    if (!isSyncTelemetryEnabled(config)) {
      return;
    }

    const isAccepted = deps.isAccepted ?? isSyncDiagnosticsPayloadAccepted;
    if (!isAccepted({ kind: SYNC_ATTEMPT_DIARY_SUMMARY_KIND })) {
      return;
    }

    (deps.diary ?? createNativeSyncDiary()).recordSyncAttempt(
      input.source,
      input.outcome,
      input.durationMs,
    );
  } catch {
    // Swallowed by contract: see the function doc.
  }
}
