import { useNetworkState } from 'expo-network';
import { act, renderHook } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Alert, AppState, Linking, type AppStateStatus } from 'react-native';
import { useResponsiveLayout } from '../../../../src/hooks/use-responsive-layout';
import { useBackgroundSyncStatus } from '../../../../src/features/settings/use-background-sync-status';
import { useBridgeConfig } from '../../../../src/features/settings/use-bridge-config';
import { useSyncFacade } from '../../../../src/features/sync/use-sync-facade';
import { useSyncTelemetryPreference } from '../../../../src/features/settings/use-sync-telemetry-preference';
import * as batteryOptimizationModule from '../../../../src/features/sync/native-battery-optimization.helpers';
import { useSettingsScreen } from '../../../../src/features/settings/ui/SettingsScreen/use-settings-screen';
import type { SettingsScreenViewModel } from '../../../../src/features/settings/ui/SettingsScreen/settings-screen.types';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('heroui-native', () => ({
  useThemeColor: jest.fn(() => ['#2563eb', '#111111', '#777777', '#22c55e', '#f97316', '#ef4444']),
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

/** Tells whether the background card currently reports the missing battery exemption. */
function hasBatteryIssue(viewModel: SettingsScreenViewModel): boolean {
  const status = viewModel.backgroundStatus;

  return (
    status.kind === 'needs_attention' &&
    status.issues.some((issue) => issue.id === 'battery_exemption')
  );
}

describe('useSettingsScreen', () => {
  const push = jest.fn();
  const replace = jest.fn();
  const unpair = jest.fn();
  const manualSync = jest.fn();
  const setSyncTelemetryEnabled = jest.fn().mockResolvedValue(undefined);
  const mockIsExempt = jest.fn<boolean, []>();
  const mockRequestExemption = jest.fn<boolean, []>();
  const mockIsAvailable = jest.fn<boolean, []>();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    manualSync.mockResolvedValue(1);

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
        executionMode: 'android_foreground_service',
        canShowPersistentNotification: true,
      },
    });
    (useSyncFacade as jest.Mock).mockReturnValue({
      connectionStatus: 'unreachable',
      lastSyncAt: 1775811900000,
      pendingOpsCount: 3,
      requestSync: jest.fn(),
      manualSync,
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
    mockIsAvailable.mockReturnValue(true);
    (
      batteryOptimizationModule.createNativeBatteryOptimizationExemption as jest.Mock
    ).mockReturnValue({
      isAvailable: mockIsAvailable,
      isExempt: mockIsExempt,
      requestExemption: mockRequestExemption,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds the status card, the connection and the background status from the live facts', () => {
    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.syncSummary.title).toBe('Hace 181 días que no hay sync');
    expect(result.current.syncSummary.tone).toBe('warning');
    expect(result.current.syncSummary.action).toEqual({
      kind: 'sync_now',
      label: 'Reintentar ahora',
      isDisabled: false,
    });
    expect(result.current.statusIconColor).toBe('#f97316');
    expect(result.current.connection).toEqual({
      host: '192.168.1.77:9876',
      deviceId: 'bridge-abc',
    });
    expect(result.current.backgroundStatus).toEqual({
      kind: 'needs_attention',
      issues: [expect.objectContaining({ id: 'battery_exemption' })],
    });
  });

  it('collapses the background status to ok when nothing needs fixing', () => {
    mockIsExempt.mockReturnValue(true);

    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.backgroundStatus).toEqual({ kind: 'ok' });
  });

  it('runs the existing manual sync from the status action', () => {
    const { result } = renderHook(() => useSettingsScreen({}));

    act(() => {
      result.current.handleStatusAction?.();
    });

    expect(manualSync).toHaveBeenCalledTimes(1);
  });

  it('logs and swallows a rejected manual sync, since the status card already reflects it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(jest.fn());
    manualSync.mockRejectedValueOnce(new Error('Bridge unreachable'));

    const { result } = renderHook(() => useSettingsScreen({}));

    await act(async () => {
      result.current.handleStatusAction?.();
      await Promise.resolve();
    });

    expect(warn).toHaveBeenCalledWith('[SettingsScreen] Manual sync failed:', expect.any(Error));
  });

  it('hides the status action while a sync is running', () => {
    (useSyncFacade as jest.Mock).mockReturnValue({
      connectionStatus: 'syncing',
      lastSyncAt: 1775811900000,
      pendingOpsCount: 3,
      requestSync: jest.fn(),
      manualSync,
    });

    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.syncSummary.action).toBeNull();
    expect(result.current.handleStatusAction).toBeNull();
  });

  it('opens the app settings to fix a background service that is not running', () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    (useBackgroundSyncStatus as jest.Mock).mockReturnValue({
      snapshot: {
        registrationStatus: 'unregistered',
        executionMode: 'android_foreground_service',
        canShowPersistentNotification: true,
      },
    });
    mockIsExempt.mockReturnValue(true);

    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.backgroundStatus).toEqual({
      kind: 'needs_attention',
      issues: [expect.objectContaining({ id: 'background_service' })],
    });

    act(() => {
      result.current.backgroundIssueActionHandlers.open_app_settings();
    });

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(mockRequestExemption).not.toHaveBeenCalled();
  });

  it('requests the battery exemption from its background issue', () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);

    const { result } = renderHook(() => useSettingsScreen({}));

    act(() => {
      result.current.backgroundIssueActionHandlers.request_battery_exemption();
    });

    expect(mockRequestExemption).toHaveBeenCalledTimes(1);
    expect(openSettings).not.toHaveBeenCalled();
  });

  it('exposes the responsive layout mode to the view', () => {
    (useResponsiveLayout as jest.Mock).mockReturnValue({
      layout: 'tablet-landscape',
      isCompact: false,
    });

    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.layoutMode).toBe('tablet-landscape');
  });

  it('navigates to setup from the status action when there is no PC paired', () => {
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
      manualSync,
    });

    const { result } = renderHook(() => useSettingsScreen({}));

    act(() => {
      result.current.handleStatusAction?.();
    });

    expect(push).toHaveBeenCalledWith('/setup');
    expect(manualSync).not.toHaveBeenCalled();
    expect(result.current.syncSummary.action?.kind).toBe('go_to_setup');
    expect(result.current.backgroundStatus).toEqual({ kind: 'inactive' });
    expect(result.current.connection).toBeNull();
  });

  it('disables the manual sync while the device is offline', () => {
    (useNetworkState as jest.Mock).mockReturnValue({
      isConnected: false,
      isInternetReachable: false,
    });

    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.syncSummary.chipLabel).toBe('Sin Wi-Fi');
    expect(result.current.syncSummary.action?.isDisabled).toBe(true);
  });

  it('confirms unpairing and redirects to setup in repair mode after success', async () => {
    unpair.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useSettingsScreen({}));

    act(() => {
      result.current.handleRePair();
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

  it('reports the battery exemption only on an available, non-exempt device', () => {
    const { result: notExempt } = renderHook(() => useSettingsScreen({}));
    expect(hasBatteryIssue(notExempt.current)).toBe(true);

    mockIsExempt.mockReturnValue(true);
    const { result: exempt } = renderHook(() => useSettingsScreen({}));
    expect(hasBatteryIssue(exempt.current)).toBe(false);

    mockIsExempt.mockReturnValue(false);
    mockIsAvailable.mockReturnValue(false);
    const { result: unavailable } = renderHook(() => useSettingsScreen({}));
    expect(hasBatteryIssue(unavailable.current)).toBe(false);
  });

  it('re-reads isExempt after requesting, without trusting the request return value', () => {
    // requestExemption() reports `false` (e.g. the dialog failed to launch) while isExempt()'s
    // SECOND read reports `true` -- deliberately divergent values, so a bug that trusted
    // requestExemption()'s return instead of re-reading isExempt() would observably fail here.
    mockIsExempt.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mockRequestExemption.mockReturnValue(false);

    const { result } = renderHook(() => useSettingsScreen({}));

    expect(hasBatteryIssue(result.current)).toBe(true);

    act(() => {
      result.current.backgroundIssueActionHandlers.request_battery_exemption();
    });

    expect(mockRequestExemption).toHaveBeenCalledTimes(1);
    expect(hasBatteryIssue(result.current)).toBe(false);
  });

  it('re-reads the exemption when the app returns to the foreground', () => {
    // The read taken right after `requestExemption()` still sees the pre-decision state: that
    // call only launches the system dialog, which takes the user OUT of the app before they
    // grant anything. The grant becomes observable when the app comes back.
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

    expect(hasBatteryIssue(result.current)).toBe(true);
    expect(changeHandlers).toHaveLength(1);

    mockIsExempt.mockReturnValue(true);
    act(() => {
      changeHandlers.forEach((handler) => handler('active'));
    });

    expect(hasBatteryIssue(result.current)).toBe(false);
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
    expect(hasBatteryIssue(result.current)).toBe(true);
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
