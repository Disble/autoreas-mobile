import { act, renderHook } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';
import { useSetupQrScanner } from '../../../src/features/setup/ui/SetupQrScanner/use-setup-qr-scanner';

describe('useSetupQrScanner', () => {
  const requestPermission = jest.fn();
  const onClose = jest.fn();
  const onScan = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: false, canAskAgain: false },
      requestPermission,
    ]);
  });

  it('surfaces the denied permission state when camera access is blocked', () => {
    const { result } = renderHook(() =>
      useSetupQrScanner({ isBusy: false, isOpen: true, onClose, onScan }),
    );

    expect(result.current.permissionState).toBe('denied');
    expect(result.current.canRenderCamera).toBe(false);
  });

  it('requests camera permission when the CTA is pressed', async () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: false, canAskAgain: true },
      requestPermission,
    ]);

    const { result } = renderHook(() =>
      useSetupQrScanner({ isBusy: false, isOpen: true, onClose, onScan }),
    );

    await act(async () => {
      await result.current.handleRequestPermission();
    });

    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('resets duplicate scan suppression after the scanner closes', () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: true, canAskAgain: true },
      requestPermission,
    ]);

    const { result, rerender } = renderHook(
      (props: { readonly isOpen: boolean }) =>
        useSetupQrScanner({
          isBusy: false,
          isOpen: props.isOpen,
          onClose,
          onScan,
        }),
      {
        initialProps: { isOpen: true },
      },
    );

    act(() => {
      result.current.handleBarcodeScanned({ data: 'autoreas-mobile://pair?v=1&ip=1.1.1.1&port=8080&token=abc' });
      result.current.handleBarcodeScanned({ data: 'autoreas-mobile://pair?v=1&ip=1.1.1.1&port=8080&token=abc' });
    });

    rerender({ isOpen: false });
    rerender({ isOpen: true });

    act(() => {
      result.current.handleBarcodeScanned({ data: 'autoreas-mobile://pair?v=1&ip=1.1.1.1&port=8080&token=abc' });
    });

    expect(onScan).toHaveBeenCalledTimes(2);
  });
});
