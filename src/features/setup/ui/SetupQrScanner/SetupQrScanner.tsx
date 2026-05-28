import { CameraView } from 'expo-camera';
import { Alert as HeroAlert, Button, Card, Spinner } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import {
  SETUP_QR_SCANNER_BARCODE_TYPES,
  SETUP_QR_SCANNER_BUSY_LABEL,
  SETUP_QR_SCANNER_CLOSE_LABEL,
  SETUP_QR_SCANNER_REQUEST_PERMISSION_LABEL,
  SETUP_QR_SCANNER_TITLE,
} from './setup-qr-scanner.constants';
import type { SetupQrScannerProps } from './setup-qr-scanner.types';
import { useSetupQrScanner } from './use-setup-qr-scanner';

export function SetupQrScanner(props: SetupQrScannerProps) {
  const {
    canRenderCamera,
    isOpen,
    permissionMessage,
    permissionState,
    showPermissionButton,
    handleBarcodeScanned,
    handleClose,
    handleRequestPermission,
  } = useSetupQrScanner(props);

  if (!isOpen) {
    return null;
  }

  return (
    <Card className="border-border/60 bg-background/70 border p-4">
      <Card.Body className="gap-3">
        <AppText className="text-lg font-semibold text-foreground">
          {SETUP_QR_SCANNER_TITLE}
        </AppText>

        {canRenderCamera ? (
          <View className="border-border overflow-hidden rounded-xl border">
            <CameraView
              barcodeScannerSettings={{
                barcodeTypes: [...SETUP_QR_SCANNER_BARCODE_TYPES],
              }}
              onBarcodeScanned={handleBarcodeScanned}
              style={{ minHeight: 240 }}
              testID="setup-qr-camera"
            />
          </View>
        ) : (
          <HeroAlert status={permissionState === 'denied' ? 'warning' : 'accent'}>
            <HeroAlert.Indicator />
            <HeroAlert.Content>
              <HeroAlert.Description>{permissionMessage}</HeroAlert.Description>
            </HeroAlert.Content>
          </HeroAlert>
        )}

        {props.isBusy ? (
          <View className="flex-row items-center gap-2">
            <Spinner />
            <AppText className="text-sm text-muted">{SETUP_QR_SCANNER_BUSY_LABEL}</AppText>
          </View>
        ) : null}

        <View className="flex-row flex-wrap gap-3">
          {showPermissionButton ? (
            <Button
              onPress={() => {
                void handleRequestPermission();
              }}
              variant="secondary"
            >
              <Button.Label>{SETUP_QR_SCANNER_REQUEST_PERMISSION_LABEL}</Button.Label>
            </Button>
          ) : null}

          <Button onPress={handleClose} variant="ghost">
            <Button.Label>{SETUP_QR_SCANNER_CLOSE_LABEL}</Button.Label>
          </Button>
        </View>
      </Card.Body>
    </Card>
  );
}
