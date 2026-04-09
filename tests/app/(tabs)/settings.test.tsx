import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import SettingsScreen from '../../../src/app/(tabs)/settings';
import { useBridgeConfig } from '../../../src/features/settings/use-bridge-config';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('../../../src/features/settings/use-bridge-config', () => ({
  useBridgeConfig: jest.fn(),
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('R1: muestra deviceName, IP, puerto y deviceId cuando isConfigured=true', () => {
    render(<SettingsScreen />);

    expect(screen.getByText('Bridge Living')).toBeTruthy();
    expect(screen.getByText('192.168.1.77:8080')).toBeTruthy();
    expect(screen.getByText('bridge-abc')).toBeTruthy();
  });

  it('R2: muestra mensaje Sin bridge configurado cuando isConfigured=false', () => {
    (useBridgeConfig as jest.Mock).mockReturnValue({
      config: null,
      isConfigured: false,
      isUnpairing: false,
      error: null,
      unpair: mockUnpair,
    });

    render(<SettingsScreen />);

    expect(screen.getByText('Sin bridge configurado')).toBeTruthy();
    expect(screen.getByLabelText('Ir al setup')).toBeTruthy();
  });

  it('R3: presionar Re-emparejar muestra Alert, confirmar llama unpair + navega a /setup', async () => {
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
    expect(mockReplace).toHaveBeenCalledWith('/setup');
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
