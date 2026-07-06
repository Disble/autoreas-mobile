import { useNetworkState } from 'expo-network';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import SettingsScreen from '../../../src/app/(tabs)/settings';
import { useBackgroundSyncStatus } from '../../../src/features/settings/use-background-sync-status';
import { useBridgeConfig } from '../../../src/features/settings/use-bridge-config';
import { useSyncFacade } from '../../../src/features/sync/use-sync-facade';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('expo-network', () => ({
  useNetworkState: jest.fn(),
}));

jest.mock('../../../src/features/settings/use-bridge-config', () => ({
  useBridgeConfig: jest.fn(),
}));

jest.mock('../../../src/features/settings/use-background-sync-status', () => ({
  useBackgroundSyncStatus: jest.fn(),
}));

jest.mock('../../../src/features/sync/use-sync-facade', () => ({
  useSyncFacade: jest.fn(),
}));

jest.mock('@react-navigation/elements', () => ({
  useHeaderHeight: () => 64,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

describe('SettingsScreen', () => {
  const mockPush = jest.fn();
  const mockReplace = jest.fn();
  const mockUnpair = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    jest.useFakeTimers().setSystemTime(new Date(1782810300000));

    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
      replace: mockReplace,
    });

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
      unpair: mockUnpair,
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
      connectionStatus: 'error',
      lastSyncAt: 1775811900000,
      pendingOpsCount: 3,
      requestSync: jest.fn(),
      syncError: 'Bridge unreachable at http://192.168.1.10:8080',
      manualSync: jest.fn(),
    });

    (useNetworkState as jest.Mock).mockReturnValue({
      isConnected: true,
      isInternetReachable: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('R1: muestra deviceName, IP, puerto y deviceId cuando isConfigured=true', () => {
    render(<SettingsScreen />);

    expect(screen.getByText('Bridge Living')).toBeTruthy();
    expect(screen.getByText('192.168.1.77:8080')).toBeTruthy();
    expect(screen.getByText('bridge-abc')).toBeTruthy();
  });

  it('R1b: muestra el estado observable del background sync y el último error conocido', () => {
    render(<SettingsScreen />);

    expect(screen.getByText('Estado de sync en segundo plano')).toBeTruthy();
    expect(screen.getAllByText('Sync pendiente')).toHaveLength(2);
    expect(screen.getAllByText('3 cambios esperando sync')).toHaveLength(3);
    expect(
      screen.getAllByText('Tus cambios siguen guardados en este dispositivo. Hace 81 días que el bridge no confirma cambios.'),
    ).toHaveLength(2);
    expect(screen.getByText('Re-emparejar bridge')).toBeTruthy();
    expect(screen.getByText('Último sync con error')).toBeTruthy();
    expect(screen.getByText('Bridge timeout after 10s')).toBeTruthy();
    expect(screen.getByText('Task en segundo plano')).toBeTruthy();
    expect(screen.queryByText('Emparejado')).toBeNull();
    expect(screen.queryByText('Conexión local lista para sincronizar')).toBeNull();
  });

  it('R1c: muestra bridge no disponible en la card izquierda cuando falla el reachability sin backlog viejo', () => {
    (useSyncFacade as jest.Mock).mockReturnValue({
      connectionStatus: 'error',
      lastSyncAt: Date.now() - 60 * 60 * 1000,
      pendingOpsCount: 0,
      requestSync: jest.fn(),
      syncError: 'Bridge unreachable at http://192.168.1.10:8080',
      manualSync: jest.fn(),
    });

    render(<SettingsScreen />);

    expect(screen.getByText('Bridge no disponible')).toBeTruthy();
    expect(screen.getAllByText('Bridge configurado pero inaccesible')).toHaveLength(2);
    expect(screen.queryByText('Conexión local lista para sincronizar')).toBeNull();
  });

  it('R2: muestra mensaje Sin bridge configurado cuando isConfigured=false', () => {
    (useBridgeConfig as jest.Mock).mockReturnValue({
      config: null,
      isConfigured: false,
      isUnpairing: false,
      error: null,
      unpair: mockUnpair,
    });
    (useSyncFacade as jest.Mock).mockReturnValue({
      connectionStatus: 'offline',
      lastSyncAt: null,
      pendingOpsCount: 0,
      requestSync: jest.fn(),
      syncError: null,
      manualSync: jest.fn(),
    });

    render(<SettingsScreen />);

    expect(screen.getByText('Sin bridge configurado')).toBeTruthy();
    expect(screen.getByText('No disponible sin bridge emparejado')).toBeTruthy();
    expect(screen.getByLabelText('Ir al setup')).toBeTruthy();
    expect(screen.getByText('Modo local')).toBeTruthy();
    expect(screen.getAllByText('Emparejar bridge')).toHaveLength(2);
  });

  it('R3: presionar Re-emparejar muestra Alert, confirmar llama unpair + navega a /setup en modo repair', async () => {
    mockUnpair.mockResolvedValueOnce({ success: true });

    render(<SettingsScreen />);

    fireEvent.press(screen.getByLabelText('Re-emparejar bridge'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Re-emparejar bridge',
      expect.stringContaining('Se va a borrar la configuración actual'),
      expect.any(Array)
    );

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    const confirmButton = buttons[1];

    await act(async () => {
      await confirmButton.onPress();
    });

    expect(mockUnpair).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/setup?repair=1');
  });

  it('R5: cancelar el Alert no llama unpair ni navega', () => {
    render(<SettingsScreen />);

    fireEvent.press(screen.getByLabelText('Re-emparejar bridge'));

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    const cancelButton = buttons[0];

    cancelButton.onPress();

    expect(mockUnpair).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
