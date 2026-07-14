import { useNetworkState } from 'expo-network';
import { act, renderHook } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { useResponsiveLayout } from '../../../../src/hooks/use-responsive-layout';
import { useBackgroundSyncStatus } from '../../../../src/features/settings/use-background-sync-status';
import { useBridgeConfig } from '../../../../src/features/settings/use-bridge-config';
import { useSyncFacade } from '../../../../src/features/sync/use-sync-facade';
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

jest.mock('../../../../src/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: jest.fn(),
}));

describe('useSettingsScreen', () => {
  const push = jest.fn();
  const replace = jest.fn();
  const unpair = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    (useRouter as jest.Mock).mockReturnValue({ push, replace });
    (useBridgeConfig as jest.Mock).mockReturnValue({
      config: {
        id: 1,
        ip: '192.168.1.77',
        port: 8080,
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
      syncError: 'Bridge unreachable at http://192.168.1.10:8080',
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
});
