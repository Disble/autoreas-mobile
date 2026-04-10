import { act, renderHook } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { useBackgroundSyncStatus } from '../../../../src/features/settings/use-background-sync-status';
import { useBridgeConfig } from '../../../../src/features/settings/use-bridge-config';
import { useSettingsScreen } from '../../../../src/features/settings/ui/SettingsScreen/use-settings-screen';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('heroui-native', () => ({
  useThemeColor: jest.fn(() => ['#111111', '#777777']),
}));

jest.mock('../../../../src/features/settings/use-bridge-config', () => ({
  useBridgeConfig: jest.fn(),
}));

jest.mock('../../../../src/features/settings/use-background-sync-status', () => ({
  useBackgroundSyncStatus: jest.fn(),
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
        lastAttemptAt: 1775812200000,
        lastSuccessAt: 1775811900000,
        lastFailureMessage: 'Bridge timeout after 10s',
        lastTriggerSource: 'background_task',
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds the background sync section from the observable snapshot', () => {
    const { result } = renderHook(() => useSettingsScreen({}));

    expect(result.current.backgroundSyncSection.title).toBe('Último sync con error');
    expect(result.current.backgroundSyncSection.rows).toEqual(
      expect.arrayContaining([
        { label: 'Registro', value: 'Registrado' },
        { label: 'Último fallo', value: 'Bridge timeout after 10s' },
      ]),
    );
  });

  it('navigates to setup from the CTA when there is no bridge configured', () => {
    (useBridgeConfig as jest.Mock).mockReturnValue({
      config: null,
      isConfigured: false,
      isUnpairing: false,
      error: null,
      unpair,
    });

    const { result } = renderHook(() => useSettingsScreen({}));

    act(() => {
      result.current.handleGoToSetup();
    });

    expect(push).toHaveBeenCalledWith('/setup');
    expect(result.current.backgroundSyncSection.status).toBe('Sin bridge emparejado');
  });

  it('confirms unpairing and redirects to setup after success', async () => {
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
    expect(replace).toHaveBeenCalledWith('/setup');
  });
});
