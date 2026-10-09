import { useNetworkState } from 'expo-network';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Alert, Linking } from 'react-native';
import SettingsScreen from '../../../src/app/(tabs)/settings';
import { useBackgroundSyncStatus } from '../../../src/features/settings/use-background-sync-status';
import { useBridgeConfig } from '../../../src/features/settings/use-bridge-config';
import { useSyncFacade } from '../../../src/features/sync/use-sync-facade';
import { useSyncTelemetryPreference } from '../../../src/features/settings/use-sync-telemetry-preference';
import * as batteryOptimizationModule from '../../../src/features/sync/native-battery-optimization.helpers';

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

jest.mock('../../../src/features/settings/use-sync-telemetry-preference', () => ({
  useSyncTelemetryPreference: jest.fn(),
}));

jest.mock('../../../src/features/sync/use-sync-facade', () => ({
  useSyncFacade: jest.fn(),
}));

jest.mock('../../../src/features/sync/native-battery-optimization.helpers', () => ({
  createNativeBatteryOptimizationExemption: jest.fn(),
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
  const mockManualSync = jest.fn();
  const mockIsExempt = jest.fn<boolean, []>();
  const mockRequestExemption = jest.fn<boolean, []>();
  const mockIsAvailable = jest.fn<boolean, []>();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    jest.useFakeTimers().setSystemTime(new Date(1782810300000));
    mockManualSync.mockResolvedValue(1);

    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
      replace: mockReplace,
    });

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
        lastFailureMessage: null,
        lastTriggerSource: 'background_task',
        lastSyncedCount: 4,
        isCycleActive: false,
        lastBacklogReadCount: 0,
        lastPrunedOperationsCount: 0,
      },
    });

    (useSyncTelemetryPreference as jest.Mock).mockReturnValue({
      isEnabled: true,
      setEnabled: jest.fn().mockResolvedValue(undefined),
    });

    (useSyncFacade as jest.Mock).mockReturnValue({
      connectionStatus: 'unreachable',
      lastSyncAt: 1775811900000,
      pendingOpsCount: 3,
      requestSync: jest.fn(),
      syncError: 'Bridge unreachable at http://192.168.1.10:9876',
      manualSync: mockManualSync,
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
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('R1: muestra la conexión con la PC: host, puerto y deviceId', () => {
    render(<SettingsScreen />);

    const card = screen.getByTestId('settings-connection-card');
    expect(within(card).getByText('Conexión con la PC')).toBeTruthy();
    expect(within(card).getByText('192.168.1.77:9876')).toBeTruthy();
    expect(within(card).getByText('bridge-abc')).toBeTruthy();
  });

  it('R1b: muestra un solo estado de sync, sin contadores ni errores crudos', () => {
    render(<SettingsScreen />);

    const card = screen.getByTestId('settings-status-card');
    expect(within(card).getByText('Hace 81 días que no hay sync')).toBeTruthy();
    expect(
      within(card).getByText(
        'Tus 3 cambios siguen guardados en este dispositivo, pero la PC no los ha recibido. ¿Está encendida y en la misma red?',
      ),
    ).toBeTruthy();
    expect(within(card).getByText('Último sync hace 81 días · 3 por enviar')).toBeTruthy();
    expect(within(card).getByText('Reintentar ahora')).toBeTruthy();
    expect(screen.getAllByText('Hace 81 días que no hay sync')).toHaveLength(1);
    expect(screen.queryByText('Estado de sync en segundo plano')).toBeNull();
    expect(screen.queryByText('Último sync con error')).toBeNull();
    expect(screen.queryByText('Bridge timeout after 10s')).toBeNull();
    expect(screen.queryByText(/192\.168\.1\.10/)).toBeNull();
    expect(screen.queryByText('Re-emparejar bridge')).toBeNull();
  });

  it('R1c: el botón del estado dispara el sync manual existente', () => {
    render(<SettingsScreen />);

    fireEvent.press(screen.getByText('Reintentar ahora'));

    expect(mockManualSync).toHaveBeenCalledTimes(1);
  });

  it('R2: sin PC emparejada ofrece emparejar, oculta la conexión y deja el segundo plano en espera', () => {
    (useBridgeConfig as jest.Mock).mockReturnValue({
      config: null,
      isConfigured: false,
      isUnpairing: false,
      error: null,
      unpair: mockUnpair,
    });
    (useSyncFacade as jest.Mock).mockReturnValue({
      connectionStatus: 'idle',
      lastSyncAt: null,
      pendingOpsCount: 0,
      requestSync: jest.fn(),
      syncError: null,
      manualSync: mockManualSync,
    });

    render(<SettingsScreen />);

    expect(screen.getByText('Sin PC emparejada')).toBeTruthy();
    expect(screen.queryByTestId('settings-connection-card')).toBeNull();
    expect(screen.getByText('Se activa al emparejar una PC.')).toBeTruthy();

    fireEvent.press(screen.getByText('Emparejar PC'));

    expect(mockPush).toHaveBeenCalledWith('/setup');
  });

  it('R3: presionar Re-emparejar muestra Alert, confirmar llama unpair + navega a /setup en modo repair', async () => {
    mockUnpair.mockResolvedValueOnce({ success: true });

    render(<SettingsScreen />);

    fireEvent.press(screen.getByLabelText('Re-emparejar'));

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

    fireEvent.press(screen.getByLabelText('Re-emparejar'));

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    const cancelButton = buttons[0];

    cancelButton.onPress();

    expect(mockUnpair).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('muestra solo la excepción de batería que falta, con su botón', () => {
    render(<SettingsScreen />);

    const issue = screen.getByTestId('settings-background-issue-battery_exemption');
    expect(within(issue).getByText('El sync puede pausarse con la app cerrada')).toBeTruthy();
    expect(screen.queryByText('Sync automático activo')).toBeNull();

    fireEvent.press(within(issue).getByText('Permitir'));

    expect(mockRequestExemption).toHaveBeenCalledTimes(1);
  });

  it('muestra una sola línea de segundo plano cuando todo funciona', () => {
    mockIsExempt.mockReturnValue(true);

    render(<SettingsScreen />);

    const card = screen.getByTestId('settings-background-card');
    expect(within(card).getByText('Sync automático activo')).toBeTruthy();
    expect(within(card).getByText('Sigue funcionando con la app cerrada.')).toBeTruthy();
    expect(screen.queryByTestId('settings-background-issue-battery_exemption')).toBeNull();
  });

  it('no muestra la excepción de batería cuando el módulo nativo no está disponible', () => {
    mockIsAvailable.mockReturnValue(false);

    render(<SettingsScreen />);

    expect(screen.queryByTestId('settings-background-issue-battery_exemption')).toBeNull();
    expect(screen.getByText('Sync automático activo')).toBeTruthy();
  });

  it('abre los ajustes de la app cuando el servicio en segundo plano no está activo', () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    mockIsExempt.mockReturnValue(true);
    (useBackgroundSyncStatus as jest.Mock).mockReturnValue({
      snapshot: {
        registrationStatus: 'unregistered',
        executionMode: 'android_foreground_service',
        canShowPersistentNotification: true,
      },
    });

    render(<SettingsScreen />);

    const issue = screen.getByTestId('settings-background-issue-background_service');
    fireEvent.press(within(issue).getByText('Abrir ajustes'));

    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('muestra el switch de diagnóstico en la tarjeta de privacidad', () => {
    render(<SettingsScreen />);

    const card = screen.getByTestId('settings-privacy-card');
    expect(within(card).getByText('Enviar diagnóstico a la PC')).toBeTruthy();
    expect(
      within(card).getByText(
        'Ayuda a encontrar fallas de sync sin conectar el cable. Solo viajan códigos y contadores: ningún título, ruta ni dato tuyo.',
      ),
    ).toBeTruthy();
    expect(within(card).getByLabelText('Enviar diagnóstico a la PC')).toBeTruthy();
  });
});
