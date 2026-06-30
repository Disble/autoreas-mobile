import React from 'react';
import { useCameraPermissions } from 'expo-camera';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SetupQrScanner } from '../../../src/features/setup/ui/SetupQrScanner/SetupQrScanner';
import { SETUP_QR_SCANNER_CLOSE_LABEL } from '../../../src/features/setup/ui/SetupQrScanner/setup-qr-scanner.constants';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, ...props }: any) => <View {...props}>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

describe('SetupQrScanner', () => {
  const requestPermission = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps manual fallback messaging visible when camera permission is denied', () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: false, canAskAgain: false },
      requestPermission,
    ]);

    render(
      <SetupQrScanner
        isBusy={false}
        isOpen
        onClose={jest.fn()}
        onScan={jest.fn()}
      />,
    );

    expect(screen.getByText('Escaneá el QR del Bridge')).toBeTruthy();
    expect(screen.getByText(/No pudimos acceder a la cámara/)).toBeTruthy();
  });

  it('requests permission and accepts only the first duplicate scan event', () => {
    const onScan = jest.fn();
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: true, canAskAgain: true },
      requestPermission,
    ]);

    render(
      <SetupQrScanner
        isBusy={false}
        isOpen
        onClose={jest.fn()}
        onScan={onScan}
      />,
    );

    const cameraView = screen.getByTestId('setup-qr-camera');

    fireEvent(cameraView, 'onBarcodeScanned', {
      data: 'autoreas-mobile://pair?v=1&ip=192.168.1.10&port=8080&token=abc',
    });
    fireEvent(cameraView, 'onBarcodeScanned', {
      data: 'autoreas-mobile://pair?v=1&ip=192.168.1.10&port=8080&token=abc',
    });

    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('closes the full-screen scanner from the floating close control', () => {
    const onClose = jest.fn();
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: true, canAskAgain: true },
      requestPermission,
    ]);

    render(
      <SetupQrScanner
        isBusy={false}
        isOpen
        onClose={onClose}
        onScan={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText(SETUP_QR_SCANNER_CLOSE_LABEL));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
