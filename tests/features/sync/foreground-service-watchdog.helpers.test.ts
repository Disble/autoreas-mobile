import type { SQLiteDatabase } from 'expo-sqlite';
import {
  resolveForegroundServiceWatchdogDecision,
  runForegroundServiceWatchdog,
} from '../../../src/features/sync/foreground-service-watchdog.helpers';
import * as syncRuntimeStatusModule from '../../../src/features/sync/sync-runtime-status.helpers';
import * as batteryOptimizationModule from '../../../src/features/sync/native-battery-optimization.helpers';
import * as foregroundServicePresenceModule from '../../../src/features/sync/native-foreground-service-presence.helpers';
import * as notifeeAdapterModule from '../../../src/features/sync/notifee-foreground-service-adapter';
import * as sqliteSyncRuntimeModule from '../../../src/features/sync/sqlite-sync-runtime.helpers';
import { NOTIFEE_FOREGROUND_SYNC_CHANNEL_ID } from '../../../src/features/sync/notifee-foreground-service-adapter/notifee-foreground-service-adapter.constants';
import type { SyncSQLiteRuntime } from '../../../src/features/sync/sqlite-sync-runtime.types';
import type { SyncRuntimeStatusSnapshot } from '../../../src/features/sync/sync-runtime-status.types';

/** Mock for the watchdog's dedicated SQLite runtime's close(). */
const mockRuntimeClose = jest.fn<Promise<void>, []>();
/** Mock for the Notifee adapter's register(), the actual restore effect. */
const mockRegister = jest.fn<Promise<void>, []>();
/** Mock for the battery-optimization exemption seam's isExempt(). */
const mockIsExempt = jest.fn<boolean, []>();
/** Mock for the native foreground-service presence seam's isForegroundServiceRunning(). */
const mockIsForegroundServiceRunning = jest.fn<boolean, [string]>();

jest.mock('../../../src/features/sync/sync-runtime-status.helpers', () => ({
  getSyncRuntimeStatusSnapshot: jest.fn(),
  updateSyncRuntimeStatusSnapshot: jest.fn(),
}));

jest.mock('../../../src/features/sync/native-battery-optimization.helpers', () => ({
  createNativeBatteryOptimizationExemption: jest.fn(),
}));

jest.mock('../../../src/features/sync/native-foreground-service-presence.helpers', () => ({
  createNativeForegroundServicePresence: jest.fn(),
}));

jest.mock('../../../src/features/sync/notifee-foreground-service-adapter', () => ({
  createNotifeeForegroundServiceAdapter: jest.fn(),
}));

jest.mock('../../../src/features/sync/sqlite-sync-runtime.helpers', () => ({
  createSyncSQLiteRuntime: jest.fn(),
}));

describe('resolveForegroundServiceWatchdogDecision', () => {
  it('reports not_configured when the app is not supposed to be in foreground-service mode', () => {
    expect(
      resolveForegroundServiceWatchdogDecision({
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        isExempt: true,
      }),
    ).toBe('not_configured');
  });

  it('reports not_configured even when the (stale) presence check says the service is running', () => {
    expect(
      resolveForegroundServiceWatchdogDecision({
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: true,
        isExempt: true,
      }),
    ).toBe('not_configured');
  });

  it('reports already_running when configured for FGS mode and the service is actually up', () => {
    expect(
      resolveForegroundServiceWatchdogDecision({
        executionMode: 'android_foreground_service',
        isForegroundServiceRunning: true,
        isExempt: false,
      }),
    ).toBe('already_running');
  });

  it('reports blocked_not_exempt when the service is down and the app is not battery-exempt', () => {
    expect(
      resolveForegroundServiceWatchdogDecision({
        executionMode: 'android_foreground_service',
        isForegroundServiceRunning: false,
        isExempt: false,
      }),
    ).toBe('blocked_not_exempt');
  });

  it('reports restore when the service is down and the app is battery-exempt', () => {
    expect(
      resolveForegroundServiceWatchdogDecision({
        executionMode: 'android_foreground_service',
        isForegroundServiceRunning: false,
        isExempt: true,
      }),
    ).toBe('restore');
  });
});

describe('runForegroundServiceWatchdog', () => {
  const rawDb = { id: 'raw-db' } as unknown as SQLiteDatabase;

  /** Builds a runtime-status snapshot fixture, defaulting to FGS mode with the service down. */
  function buildStatusSnapshot(
    overrides: Partial<SyncRuntimeStatusSnapshot> = {},
  ): SyncRuntimeStatusSnapshot {
    return {
      registrationStatus: 'registered',
      executionMode: 'android_foreground_service',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: true,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureMessage: null,
      lastTriggerSource: null,
      lastSyncedCount: 0,
      isCycleActive: false,
      lastBacklogReadCount: 0,
      lastPrunedOperationsCount: 0,
      isBackgroundTaskRegistered: false,
      lastCycleId: null,
      lastCycleStage: null,
      lastErrorName: null,
      lastNativeErrcodeByte: null,
      lastErrorStage: null,
      consecutiveUnclosedCycles: 0,
      lastCycleStageAt: null,
      lastFailedCheckpointCount: 0,
      lastDiagnosticsDiscardedCount: null,
      lastDiagnosticsFailedRemovalCount: null,
      lastOutboxFailedWriteCount: null,
      lastDeadLetterCount: null,
      lastConflictExhaustedCount: null,
      lastStuckProcessingCount: null,
      lastOldestPendingAgeMs: null,
      lastPendingRowCount: null,
      ...overrides,
    };
  }

  function buildRuntime(): SyncSQLiteRuntime {
    return {
      owner: 'foreground_service_watchdog',
      rawDb,
      isOpen: () => true,
      open: jest.fn().mockResolvedValue(rawDb),
      withDatabase: jest.fn(),
      close: mockRuntimeClose,
    } as unknown as SyncSQLiteRuntime;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockRuntimeClose.mockResolvedValue(undefined);
    mockRegister.mockResolvedValue(undefined);
    mockIsExempt.mockReturnValue(true);
    mockIsForegroundServiceRunning.mockReturnValue(false);

    (sqliteSyncRuntimeModule.createSyncSQLiteRuntime as jest.Mock).mockReturnValue(buildRuntime());
    (syncRuntimeStatusModule.getSyncRuntimeStatusSnapshot as jest.Mock).mockResolvedValue(
      buildStatusSnapshot(),
    );
    (syncRuntimeStatusModule.updateSyncRuntimeStatusSnapshot as jest.Mock).mockResolvedValue(
      undefined,
    );
    (batteryOptimizationModule.createNativeBatteryOptimizationExemption as jest.Mock).mockReturnValue(
      { isExempt: mockIsExempt, requestExemption: jest.fn() },
    );
    (foregroundServicePresenceModule.createNativeForegroundServicePresence as jest.Mock).mockReturnValue(
      { isForegroundServiceRunning: mockIsForegroundServiceRunning },
    );
    (notifeeAdapterModule.createNotifeeForegroundServiceAdapter as jest.Mock).mockReturnValue({
      mode: 'android_foreground_service',
      register: mockRegister,
      unregister: jest.fn(),
      getStatus: jest.fn(),
    });
  });

  it('opens a dedicated runtime and always closes it', async () => {
    await runForegroundServiceWatchdog();

    expect(sqliteSyncRuntimeModule.createSyncSQLiteRuntime).toHaveBeenCalledWith({
      owner: 'foreground_service_watchdog',
    });
    expect(mockRuntimeClose).toHaveBeenCalledTimes(1);
  });

  it('takes no action when the service is already running', async () => {
    mockIsForegroundServiceRunning.mockReturnValue(true);

    await expect(runForegroundServiceWatchdog()).resolves.toBe('already_running');

    expect(mockIsForegroundServiceRunning).toHaveBeenCalledWith(
      NOTIFEE_FOREGROUND_SYNC_CHANNEL_ID,
    );
    expect(notifeeAdapterModule.createNotifeeForegroundServiceAdapter).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
    expect(syncRuntimeStatusModule.updateSyncRuntimeStatusSnapshot).toHaveBeenCalledWith(rawDb, {
      isForegroundServiceRunning: true,
    });
  });

  it('attempts a restore when the service is down and the app is exempt', async () => {
    await expect(runForegroundServiceWatchdog()).resolves.toBe('restored');

    expect(notifeeAdapterModule.createNotifeeForegroundServiceAdapter).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(syncRuntimeStatusModule.updateSyncRuntimeStatusSnapshot).toHaveBeenCalledWith(rawDb, {
      isForegroundServiceRunning: true,
    });
  });

  it('skips the restore and records the reason when the service is down and not exempt', async () => {
    mockIsExempt.mockReturnValue(false);

    await expect(runForegroundServiceWatchdog()).resolves.toBe('blocked_not_exempt');

    expect(notifeeAdapterModule.createNotifeeForegroundServiceAdapter).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
    expect(syncRuntimeStatusModule.updateSyncRuntimeStatusSnapshot).toHaveBeenCalledWith(rawDb, {
      isForegroundServiceRunning: false,
    });
  });

  it('does nothing when the app is not configured for foreground-service mode', async () => {
    (syncRuntimeStatusModule.getSyncRuntimeStatusSnapshot as jest.Mock).mockResolvedValue(
      buildStatusSnapshot({ executionMode: 'best_effort_background_task' }),
    );

    await expect(runForegroundServiceWatchdog()).resolves.toBe('not_configured');

    expect(notifeeAdapterModule.createNotifeeForegroundServiceAdapter).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
    expect(syncRuntimeStatusModule.updateSyncRuntimeStatusSnapshot).not.toHaveBeenCalled();
  });

  it('records the outcome and never propagates when the restore attempt throws', async () => {
    mockRegister.mockRejectedValue(new Error('registerForegroundService bridge failure'));

    await expect(runForegroundServiceWatchdog()).resolves.toBe('restore_failed');

    expect(syncRuntimeStatusModule.updateSyncRuntimeStatusSnapshot).toHaveBeenCalledWith(rawDb, {
      isForegroundServiceRunning: false,
    });
    expect(mockRuntimeClose).toHaveBeenCalledTimes(1);
  });

  it('degrades to a recorded error instead of crashing when a native seam throws unexpectedly', async () => {
    mockIsForegroundServiceRunning.mockImplementation(() => {
      throw new Error('native bridge unavailable');
    });

    await expect(runForegroundServiceWatchdog()).resolves.toBe('watchdog_error');

    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockRuntimeClose).toHaveBeenCalledTimes(1);
  });

  it('never rejects even when the persisted snapshot cannot be read', async () => {
    (syncRuntimeStatusModule.getSyncRuntimeStatusSnapshot as jest.Mock).mockRejectedValue(
      new Error('database is locked'),
    );

    await expect(runForegroundServiceWatchdog()).resolves.toBe('watchdog_error');
    expect(mockRuntimeClose).toHaveBeenCalledTimes(1);
  });
});
