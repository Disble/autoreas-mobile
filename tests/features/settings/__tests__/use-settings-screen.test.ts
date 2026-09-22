import { useNetworkState } from 'expo-network';
import { act, renderHook } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { useResponsiveLayout } from '../../../../src/hooks/use-responsive-layout';
import { useBackgroundSyncStatus } from '../../../../src/features/settings/use-background-sync-status';
import { useBridgeConfig } from '../../../../src/features/settings/use-bridge-config';
import { useSyncFacade } from '../../../../src/features/sync/use-sync-facade';
import { useSyncTelemetryPreference } from '../../../../src/features/settings/use-sync-telemetry-preference';
import * as batteryOptimizationModule from '../../../../src/features/sync/native-battery-optimization.helpers';
import { useSettingsScreen } from '../../../../src/features/settings/ui/SettingsScreen/use-settings-screen';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('heroui-native', () => ({
  useThemeColor: jest.fn(() => ['#111111', '#777777', '#22c55e', '#f97316', '#ef4444']),
}));

jest.mock('expo-network', () => ({
  useNetworkState: jest.fn(),
}));

jest.mock('../../../../src/features/settings/use-bridge-config', () => ({
  useBridgeConfig: jest.fn(),
}));

jest.mock('../../../../src/features/settings/use-background-sync-status', () => ({
  useBackgroundSyncStatus: jest.fn(),
}));

jest.mock('../../../../src/features/sync/use-sync-facade', () => ({
  useSyncFacade: jest.fn(),
}));

jest.mock('../../../../src/features/settings/use-sync-telemetry-preference', () => ({
  useSyncTelemetryPreference: jest.fn(),
}));

jest.mock('../../../../src/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: jest.fn(),
}));

jest.mock('../../../../src/features/sync/native-battery-optimization.helpers', () => ({
  createNativeBatteryOptimizationExemption: jest.fn(),
}));

describe('useSettingsScreen', () => {
  const push = jest.fn();
  const replace = jest.fn();
  const unpair = jest.fn();
  const setSyncTelemetryEnabled = jest.fn().mockResolvedValue(undefined);
  const mockIsExempt = jest.fn<boolean, []>();
  const mockRequestExemption = jest.fn<boolean, []>();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    (useSyncTelemetryPreference as jest.Mock).mockReturnValue({
      isEnabled: true,
      setEnabled: setSyncTelemetryEnabled,
    });

    (useRouter as jest.Mock).mockReturnValue({ push, replace });
    (useBridgeConfig as jest.Mock).mockReturnValue({
      config: {
        id: 1,
        ip: '192.168.1.77',
        port: 9876,
        deviceId: 'bridge-abc',
        deviceName: 'Bridge Living',
      },
      isConfigured: true,
      isUnpairing: false,
      error: null,
      unpair,
    });
    (useBackgroundSyncStatus as jest.Mock).mockReturnValue({
      snapshot: {
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775811900000,
        lastFailureMessage: 'Bridge timeout after 10s',
        lastTriggerSource: 'background_task',
        lastSyncedCount: 4,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
      },
    });
    (useSyncFacade as jest.Mock).mockReturnValue({
      connectionStatus: 'unreachable',
      lastSyncAt: 1775811900000,
      pendingOpsCount: 3,
      requestSync: jest.fn(),
      syncError: 'Bridge unreachable at http://192.168.1.10:9876',
      manualSync: jest.fn(),
    });
    (useResponsiveLayout as jest.Mock).mockReturnValue({
      layout: 'phone',
      isCompact: true,
    });
    (useNetworkState as jest.Mock).mockReturnValue({
      isConnected: true,
      isInternetReachable: true,
    });
    mockIsExempt.mockReturnValue(false);
    mockRequestExemption.mockReturnValue(true);
    (
      batteryOptimizationModule.createNativeBatteryOptimizationExemption as jest.Mock
    ).mockReturnValue({
      isExempt: mockIsExempt,
      requestExemption: mockRequestExemption,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds the background sync section from the observable snapshot', () => {
    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.backgroundSyncSection.title).toBe('Último sync con error');
    expect(result.current.backgroundSyncSection.tiles.map((tile) => tile.id)).toEqual(
      expect.arrayContaining(['registration', 'lastFailure']),
    );
    expect(result.current.syncSummary.title).toBe('3 cambios esperando sync');
    expect(result.current.bridgeStatus.chipLabel).toBe('Bridge no disponible');
    expect(result.current.bridgeStatus.title).toBe('Bridge configurado pero inaccesible');
    expect(result.current.syncSummary.actionKind).toBe('repair_bridge');
  });

  it('exposes the responsive layout mode to the view', () => {
    (useResponsiveLayout as jest.Mock).mockReturnValue({
      layout: 'tablet-landscape',
      isCompact: false,
    });

    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.layoutMode).toBe('tablet-landscape');
  });

  it('navigates to setup from the CTA when there is no bridge configured', () => {
    (useBridgeConfig as jest.Mock).mockReturnValue({
      config: null,
      isConfigured: false,
      isUnpairing: false,
      error: null,
      unpair,
    });
    (useSyncFacade as jest.Mock).mockReturnValue({
      connectionStatus: 'idle',
      lastSyncAt: null,
      pendingOpsCount: 0,
      requestSync: jest.fn(),
      syncError: null,
      manualSync: jest.fn(),
    });

    const { result } = renderHook(() => useSettingsScreen({}));

    act(() => {
      result.current.handleSyncSummaryAction?.();
    });

    expect(push).toHaveBeenCalledWith('/setup');
    expect(result.current.backgroundSyncSection.status).toBe('Sin bridge emparejado');
    expect(result.current.bridgeStatus.title).toBe('Sin bridge configurado');
    expect(result.current.syncSummary.actionKind).toBe('go_to_setup');
  });

  it('does not expose a repair CTA when the phone is offline', () => {
    (useNetworkState as jest.Mock).mockReturnValue({
      isConnected: false,
      isInternetReachable: false,
    });

    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.syncSummary.chipLabel).toBe('Sin conexión');
    expect(result.current.bridgeStatus.title).toBe('Teléfono sin internet');
    expect(result.current.syncSummary.actionKind).toBeNull();
    expect(result.current.handleSyncSummaryAction).toBeNull();
  });

  it('confirms unpairing and redirects to setup in repair mode after success', async () => {
    unpair.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useSettingsScreen({}));

    act(() => {
      result.current.handleSyncSummaryAction?.();
    });

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];

    await act(async () => {
      await buttons[1].onPress();
    });

    expect(unpair).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/setup?repair=1');
  });

  it('expone el estado persistido del switch de telemetría', () => {
    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.isSyncTelemetryEnabled).toBe(true);
  });

  it('propaga la elección del switch al persistidor', () => {
    const { result } = renderHook(() => useSettingsScreen({}));

    act(() => {
      result.current.handleToggleSyncTelemetry(false);
    });

    expect(setSyncTelemetryEnabled).toHaveBeenCalledWith(false);
  });

  it('exposes the live battery-exemption state', () => {
    mockIsExempt.mockReturnValue(true);

    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.isBatteryOptimizationExempt).toBe(true);
  });

  it('re-reads isExempt after requesting, without trusting the request return value', () => {
    // requestExemption() reports `false` (e.g. the dialog failed to launch) while isExempt()'s
    // SECOND read reports `true` -- deliberately divergent values, so a bug that trusted
    // requestExemption()'s return instead of re-reading isExempt() would observably fail here.
    mockIsExempt.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mockRequestExemption.mockReturnValue(false);

    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.isBatteryOptimizationExempt).toBe(false);

    act(() => {
      result.current.handleRequestBatteryExemption();
    });

    expect(mockRequestExemption).toHaveBeenCalledTimes(1);
    expect(result.current.isBatteryOptimizationExempt).toBe(true);
  });

  it('re-reads the exemption when the app returns to the foreground', () => {
    // The read taken right after `requestExemption()` still sees the pre-decision state: that
    // call only launches the system dialog, which takes the user OUT of the app before they
    // grant anything. The grant becomes observable when the app comes back, so without this
    // re-check the one screen that reports the exemption would keep saying "not exempt" right
    // after the user granted it -- reading as a broken feature on the keystone mechanism.
    const changeHandlers: ((state: AppStateStatus) => void)[] = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((type: string, handler: (state: AppStateStatus) => void) => {
        if (type === 'change') {
          changeHandlers.push(handler);
        }
        return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
      });
    mockIsExempt.mockReturnValue(false);

    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.isBatteryOptimizationExempt).toBe(false);
    expect(changeHandlers).toHaveLength(1);

    mockIsExempt.mockReturnValue(true);
    act(() => {
      changeHandlers.forEach((handler) => handler('active'));
    });

    expect(result.current.isBatteryOptimizationExempt).toBe(true);
  });

  it('ignores app-state transitions that are not a return to the foreground', () => {
    const changeHandlers: ((state: AppStateStatus) => void)[] = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((type: string, handler: (state: AppStateStatus) => void) => {
        if (type === 'change') {
          changeHandlers.push(handler);
        }
        return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
      });
    mockIsExempt.mockReturnValue(false);

    const { result } = renderHook(() => useSettingsScreen({}));

    mockIsExempt.mockReturnValue(true);
    act(() => {
      changeHandlers.forEach((handler) => handler('background'));
    });

    // Going to the background cannot have changed the grant, so re-reading there would only
    // churn state on every app switch.
    expect(result.current.isBatteryOptimizationExempt).toBe(false);
  });

  it('unsubscribes the app-state listener on unmount', () => {
    const remove = jest.fn();
    jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove } as unknown as ReturnType<typeof AppState.addEventListener>);

    const { unmount } = renderHook(() => useSettingsScreen({}));
    unmount();

    expect(remove).toHaveBeenCalledTimes(1);
  });
});
