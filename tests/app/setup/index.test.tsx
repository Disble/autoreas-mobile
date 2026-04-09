import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { useURL } from 'expo-linking';
import { useRouter } from 'expo-router';
import { useToast } from 'heroui-native';
import SetupScreen from '../../../src/app/setup/index';
import { usePairDevice } from '../../../src/features/setup/use-pair-device';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('expo-linking', () => ({
  useURL: jest.fn(),
}));

jest.mock('../../../src/features/setup/use-pair-device', () => ({
  usePairDevice: jest.fn(),
}));

describe('SetupScreen', () => {
  const mockReplace = jest.fn();
  const mockPair = jest.fn();
  const mockToastShow = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('R2: should render the manual form and allow manual input', () => {
    (useURL as jest.Mock).mockReturnValue(null);
    render(<SetupScreen />);

    expect(screen.getByText('Dirección IP')).toBeTruthy();
    expect(screen.getByText('Puerto')).toBeTruthy();
    expect(screen.getByText('Token de emparejamiento')).toBeTruthy();

    const ipInput = screen.getByPlaceholderText('Ej: 192.168.1.10');
    const portInput = screen.getByPlaceholderText('8080');
    const tokenInput = screen.getByPlaceholderText('Token mostrado en el Bridge');

    fireEvent.changeText(ipInput, '10.0.0.1');
    fireEvent.changeText(portInput, '9000');
    fireEvent.changeText(tokenInput, 'abc');

    expect(ipInput.props.value).toBe('10.0.0.1');
    expect(portInput.props.value).toBe('9000');
    expect(tokenInput.props.value).toBe('abc');
  });

  it('R5: should prepopulate form when deep link is provided', () => {
    (useURL as jest.Mock).mockReturnValue('autoreas://pair?ip=192.168.1.50&port=3000&token=linktoken');

    render(<SetupScreen />);

    expect(screen.getByPlaceholderText('Ej: 192.168.1.10').props.value).toBe('192.168.1.50');
    expect(screen.getByPlaceholderText('8080').props.value).toBe('3000');
    expect(screen.getByPlaceholderText('Token mostrado en el Bridge').props.value).toBe('linktoken');
  });

  it('should call pair and redirect on success', async () => {
    (useURL as jest.Mock).mockReturnValue(null);
    mockPair.mockResolvedValueOnce({ success: true });

    render(<SetupScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('Ej: 192.168.1.10'), '10.0.0.1');
    fireEvent.changeText(screen.getByPlaceholderText('Token mostrado en el Bridge'), 'abc');

    await act(async () => {
      fireEvent.press(screen.getByText('Emparejar Bridge'));
    });

    expect(mockPair).toHaveBeenCalledWith({ ip: '10.0.0.1', port: 8080, token: 'abc' });
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });

  it('should show a toast if validation fails', async () => {
    (useURL as jest.Mock).mockReturnValue(null);
    render(<SetupScreen />);

    await act(async () => {
      fireEvent.press(screen.getByText('Emparejar Bridge'));
    });

    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'warning',
        label: 'Campos incompletos',
      })
    );
    expect(mockPair).not.toHaveBeenCalled();
  });

  it('should show a toast on pair failure', async () => {
    (useURL as jest.Mock).mockReturnValue(null);
    mockPair.mockResolvedValueOnce({ success: false, error: 'Network failed' });

    render(<SetupScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('Ej: 192.168.1.10'), '10.0.0.1');
    fireEvent.changeText(screen.getByPlaceholderText('Token mostrado en el Bridge'), 'abc');

    await act(async () => {
      fireEvent.press(screen.getByText('Emparejar Bridge'));
    });

    expect(mockPair).toHaveBeenCalled();
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'danger',
        label: 'Error de conexión',
      })
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
