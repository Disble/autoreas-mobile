import { Ionicons } from '@expo/vector-icons';
import { CameraView } from 'expo-camera';
import { Alert as HeroAlert, Button, Spinner, cn, useThemeColor } from 'heroui-native';
import { Modal, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../../../components/app-text';
import {
  SETUP_QR_SCANNER_BARCODE_TYPES,
  SETUP_QR_SCANNER_BUSY_LABEL,
  SETUP_QR_SCANNER_CLOSE_LABEL,
  SETUP_QR_SCANNER_HINT,
  SETUP_QR_SCANNER_REQUEST_PERMISSION_LABEL,
  SETUP_QR_SCANNER_SUBTITLE,
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

  const [themeColorForeground] = useThemeColor(['foreground']);

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
      visible={isOpen}
    >
      <View className="flex-1 bg-background">
        {canRenderCamera ? (
          <View className="absolute bottom-0 left-0 right-0 top-0">
            <CameraView
              barcodeScannerSettings={{
                barcodeTypes: [...SETUP_QR_SCANNER_BARCODE_TYPES],
              }}
              onBarcodeScanned={handleBarcodeScanned}
              style={{ flex: 1 }}
              testID="setup-qr-camera"
            />
            <View className="absolute bottom-0 left-0 right-0 top-0 bg-background/35" />
          </View>
        ) : null}

        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
          <View className="flex-row items-start justify-between gap-3 px-6 pt-2">
            <View className="flex-1 gap-1">
              <AppText className="text-xl font-bold tracking-tight text-foreground">
                {SETUP_QR_SCANNER_TITLE}
              </AppText>
              <AppText className="text-sm text-muted">
                {SETUP_QR_SCANNER_SUBTITLE}
              </AppText>
            </View>
            <Button
              accessibilityLabel={SETUP_QR_SCANNER_CLOSE_LABEL}
              className="h-11 w-11 rounded-full bg-surface-secondary"
              isIconOnly
              onPress={handleClose}
              variant="ghost"
            >
              <Ionicons color={themeColorForeground} name="close" size={22} />
            </Button>
          </View>

          <View className="flex-1 items-center justify-center px-8">
            {canRenderCamera ? (
              <View className="relative h-64 w-64 max-w-full">
                <View className="absolute left-0 top-0 h-10 w-10 rounded-tl-3xl border-l-4 border-t-4 border-accent" />
                <View className="absolute right-0 top-0 h-10 w-10 rounded-tr-3xl border-r-4 border-t-4 border-accent" />
                <View className="absolute bottom-0 left-0 h-10 w-10 rounded-bl-3xl border-b-4 border-l-4 border-accent" />
                <View className="absolute bottom-0 right-0 h-10 w-10 rounded-br-3xl border-b-4 border-r-4 border-accent" />
              </View>
            ) : (
              <HeroAlert
                status={permissionState === 'denied' ? 'warning' : 'accent'}
              >
                <HeroAlert.Indicator />
                <HeroAlert.Content>
                  <HeroAlert.Description>{permissionMessage}</HeroAlert.Description>
                </HeroAlert.Content>
              </HeroAlert>
            )}
          </View>

          <View className="gap-3 px-6 pb-4">
            {canRenderCamera ? (
              <View className="items-center">
                <View className="rounded-full bg-background/70 px-4 py-2">
                  <AppText className="text-sm font-medium text-foreground">
                    {SETUP_QR_SCANNER_HINT}
                  </AppText>
                </View>
              </View>
            ) : null}

            {props.isBusy ? (
              <View className="flex-row items-center justify-center gap-2 rounded-2xl bg-background/70 py-2.5">
                <Spinner />
                <AppText className="text-sm text-foreground">
                  {SETUP_QR_SCANNER_BUSY_LABEL}
                </AppText>
              </View>
            ) : null}

            {showPermissionButton ? (
              <Button
                className={cn('w-full')}
                onPress={() => {
                  void handleRequestPermission();
                }}
                size="lg"
                variant="primary"
              >
                <Ionicons
                  color={themeColorForeground}
                  name="camera-outline"
                  size={18}
                />
                <Button.Label>{SETUP_QR_SCANNER_REQUEST_PERMISSION_LABEL}</Button.Label>
              </Button>
            ) : null}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
