import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useLinkingURL } from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useToast } from 'heroui-native';
import { SetupScreen } from '../../../src/features/setup/ui/SetupScreen';
import { usePairDevice } from '../../../src/features/setup/use-pair-device';

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock('expo-linking', () => ({
  useLinkingURL: jest.fn(),
}));

jest.mock('../../../src/features/setup/use-pair-device', () => ({
  usePairDevice: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('../../../src/features/setup/ui/SetupQrScanner', () => {
  const { Pressable, Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    SetupQrScanner: ({
      isOpen,
      onScan,
    }: {
      readonly isOpen: boolean;
      readonly onScan: (rawValue: string) => void;
    }) => {
      if (!isOpen) {
        return null;
      }

      return (
        <View>
          <Text>Mock QR Scanner</Text>
          <Pressable
            onPress={() =>
              onScan('autoreas-mobile://pair?v=1&ip=192.168.1.10&port=8080&token=abc')
            }
            testID="mock-scan-valid"
          />
          <Pressable
            onPress={() => onScan('autoreas://pair?ip=192.168.1.10&port=8080&token=abc')}
            testID="mock-scan-invalid"
          />
        </View>
      );
    },
  };
});

describe('SetupScreen', () => {
  const mockReplace = jest.fn();
  const mockPair = jest.fn();
  const mockToastShow = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useLinkingURL as jest.Mock).mockReturnValue(null);
    (useLocalSearchParams as jest.Mock).mockReturnValue({});
    (useRouter as jest.Mock).mockReturnValue({ replace: mockReplace });
    (usePairDevice as jest.Mock).mockReturnValue({
      pair: mockPair,
      isLoading: false,
      error: null,
    });
    (useToast as jest.Mock).mockReturnValue({
      toast: { show: mockToastShow, hide: jest.fn() },
      isToastVisible: false,
    });
  });

  it('keeps the manual fallback visible and editable', () => {
    render(<SetupScreen />);

    const ipInput = screen.getByPlaceholderText('Ej: 192.168.1.10');
    const portInput = screen.getByPlaceholderText('8080');
    const tokenInput = screen.getByPlaceholderText('Token mostrado en el Bridge');

    fireEvent.changeText(ipInput, '10.0.0.1');
    fireEvent.changeText(portInput, '9000');
    fireEvent.changeText(tokenInput, 'abc');

    expect(ipInput.props.value).toBe('10.0.0.1');
    expect(portInput.props.value).toBe('9000');
    expect(tokenInput.props.value).toBe('abc');
    expect(screen.getByText('Escanear QR del Bridge')).toBeTruthy();
  });

  it('prefills and auto-submits the canonical deep link through the shared pairing pipeline', async () => {
    mockPair.mockResolvedValueOnce({ success: true });
    (useLinkingURL as jest.Mock).mockReturnValue(
      'autoreas-mobile://pair?v=1&ip=192.168.1.50&port=3000&token=linktoken',
    );

    render(<SetupScreen />);

    await waitFor(() => {
      expect(mockPair).toHaveBeenCalledWith({
        ip: '192.168.1.50',
        port: 3000,
        token: 'linktoken',
      });
    });

    expect(screen.getByPlaceholderText('Ej: 192.168.1.10').props.value).toBe('192.168.1.50');
    expect(screen.getByPlaceholderText('8080').props.value).toBe('3000');
    expect(screen.getByPlaceholderText('Token mostrado en el Bridge').props.value).toBe('linktoken');
  });

  it('ignores the stale launch deep link when setup is opened from re-pair', async () => {
    (useLinkingURL as jest.Mock).mockReturnValue(
      'autoreas-mobile://pair?v=1&ip=192.168.1.50&port=3000&token=linktoken',
    );
    (useLocalSearchParams as jest.Mock).mockReturnValue({ repair: '1' });

    render(<SetupScreen />);

    await waitFor(() => {
      expect(mockPair).not.toHaveBeenCalled();
    });

    expect(screen.getByPlaceholderText('Ej: 192.168.1.10').props.value).toBe('');
    expect(screen.getByPlaceholderText('8080').props.value).toBe('8080');
    expect(screen.getByPlaceholderText('Token mostrado en el Bridge').props.value).toBe('');
  });

  it('rejects invalid QR or deep-link payloads without calling pairing', async () => {
    (useLinkingURL as jest.Mock).mockReturnValue('autoreas://pair?ip=192.168.1.50&port=3000&token=linktoken');

    render(<SetupScreen />);

    await waitFor(() => {
      expect(mockPair).not.toHaveBeenCalled();
    });

    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'warning',
        label: 'QR o deep link inválido',
      }),
    );

    const ipInput = screen.getByPlaceholderText('Ej: 192.168.1.10');
    fireEvent.changeText(ipInput, '192.168.1.77');
    expect(ipInput.props.value).toBe('192.168.1.77');
  });

  it('prefills and auto-submits scanned QR values using the same pairing pipeline', async () => {
    mockPair.mockResolvedValueOnce({ success: true });

    render(<SetupScreen />);

    fireEvent.press(screen.getByText('Escanear QR del Bridge'));
    fireEvent.press(screen.getByTestId('mock-scan-valid'));

    await waitFor(() => {
      expect(mockPair).toHaveBeenCalledWith({
        ip: '192.168.1.10',
        port: 8080,
        token: 'abc',
      });
    });
  });

  it('preserves scanned values for manual correction when pairing fails after QR autofill', async () => {
    const diagnosticMessage =
      'Se completó el emparejamiento, pero el Bridge rechazó la sincronización inicial. Volvé a generar el token e intentá de nuevo.';

    mockPair.mockResolvedValueOnce({ success: false, error: diagnosticMessage });

    render(<SetupScreen />);

    fireEvent.press(screen.getByText('Escanear QR del Bridge'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('mock-scan-valid'));
    });

    expect(screen.getByPlaceholderText('Ej: 192.168.1.10').props.value).toBe('192.168.1.10');
    expect(screen.getByPlaceholderText('8080').props.value).toBe('8080');
    expect(screen.getByPlaceholderText('Token mostrado en el Bridge').props.value).toBe('abc');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'danger',
        description: diagnosticMessage,
      }),
    );

    const ipInput = screen.getByPlaceholderText('Ej: 192.168.1.10');
    fireEvent.changeText(ipInput, '192.168.1.99');
    expect(ipInput.props.value).toBe('192.168.1.99');
  });
});
