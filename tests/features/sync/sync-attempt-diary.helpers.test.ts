import type { SQLiteDatabase } from 'expo-sqlite';
import { recordForegroundSyncAttempt } from '../../../src/features/sync/sync-attempt-diary.helpers';
import type { NativeSyncDiary } from '../../../src/features/sync/native-foreground-sync-ticker.types';

/** A dummy database handle: the config read that would use it is injected. */
const RAW_DB = { id: 'raw-db' } as unknown as SQLiteDatabase;

/** A recording native diary whose calls each test reads back. */
function buildDiary(): NativeSyncDiary & { recordSyncAttempt: jest.Mock } {
  return { recordSyncAttempt: jest.fn(), recordRuntimeTransition: jest.fn() };
}

describe('recordForegroundSyncAttempt', () => {
  it('counts the attempt in the native diary with its trigger source, outcome and duration', async () => {
    const diary = buildDiary();
    const readConfig = jest.fn().mockResolvedValue({ isSyncTelemetryEnabled: true });

    await recordForegroundSyncAttempt(
      { rawDb: RAW_DB, source: 'network_regained', outcome: 'failed', durationMs: 840 },
      { readConfig, diary },
    );

    expect(readConfig).toHaveBeenCalledWith(RAW_DB);
    expect(diary.recordSyncAttempt).toHaveBeenCalledWith('network_regained', 'failed', 840);
  });

  it('counts an attempt on a config row that predates the switch, which means enabled', async () => {
    const diary = buildDiary();

    await recordForegroundSyncAttempt(
      { rawDb: RAW_DB, source: 'manual', outcome: 'closed', durationMs: 5 },
      { readConfig: async () => ({ isSyncTelemetryEnabled: null }), diary },
    );

    expect(diary.recordSyncAttempt).toHaveBeenCalledWith('manual', 'closed', 5);
  });

  it('records nothing while the user switched diagnostics off', async () => {
    const diary = buildDiary();

    await recordForegroundSyncAttempt(
      { rawDb: RAW_DB, source: 'manual', outcome: 'closed', durationMs: 5 },
      { readConfig: async () => ({ isSyncTelemetryEnabled: false }), diary },
    );

    expect(diary.recordSyncAttempt).not.toHaveBeenCalled();
  });

  it('records nothing while the bridge does not accept the hourly summary', async () => {
    const diary = buildDiary();
    const isAccepted = jest.fn().mockReturnValue(false);

    await recordForegroundSyncAttempt(
      { rawDb: RAW_DB, source: 'manual', outcome: 'closed', durationMs: 5 },
      { readConfig: async () => ({ isSyncTelemetryEnabled: true }), diary, isAccepted },
    );

    expect(isAccepted).toHaveBeenCalledWith({ kind: 'hourly_summary' });
    expect(diary.recordSyncAttempt).not.toHaveBeenCalled();
  });

  it('records nothing and never rejects when the config cannot be read', async () => {
    const diary = buildDiary();

    await expect(
      recordForegroundSyncAttempt(
        { rawDb: RAW_DB, source: 'manual', outcome: 'closed', durationMs: 5 },
        { readConfig: async () => Promise.reject(new Error('database closed')), diary },
      ),
    ).resolves.toBeUndefined();

    expect(diary.recordSyncAttempt).not.toHaveBeenCalled();
  });

  it('never rejects when the diary itself throws', async () => {
    const diary = buildDiary();
    diary.recordSyncAttempt.mockImplementation(() => {
      throw new Error('native gone');
    });

    await expect(
      recordForegroundSyncAttempt(
        { rawDb: RAW_DB, source: 'manual', outcome: 'closed', durationMs: 5 },
        { readConfig: async () => ({ isSyncTelemetryEnabled: true }), diary },
      ),
    ).resolves.toBeUndefined();
  });
});
