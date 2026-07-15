import { useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  getSetupQrScannerPermissionMessage,
  getSetupQrScannerPermissionState,
  shouldIgnoreSetupQrScan,
} from './setup-qr-scanner.helpers';
import type {
  SetupQrPermissionSnapshot,
  SetupQrScanEvent,
  SetupQrScannerProps,
  SetupQrScannerViewModel,
} from './setup-qr-scanner.types';

/** Coordinates setup qr scanner state and actions. */
export function useSetupQrScanner(
  props: SetupQrScannerProps,
): SetupQrScannerViewModel {
  // 1. Refs
  const acceptedScanValueRef = useRef<string | null>(null);

  // 2. State

  // 3. Context/3rd Party Hooks
  const [permission, requestPermission] = useCameraPermissions();

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)
  const { isBusy, isOpen, onClose, onScan } = props;
  const permissionSnapshot = useMemo<SetupQrPermissionSnapshot | null>(
    () =>
      permission
        ? {
            granted: permission.granted,
            canAskAgain: permission.canAskAgain,
          }
        : null,
    [permission],
  );
  const permissionState = useMemo(
    () => getSetupQrScannerPermissionState(permissionSnapshot),
    [permissionSnapshot],
  );
  const permissionMessage = useMemo(
    () => getSetupQrScannerPermissionMessage(permissionState),
    [permissionState],
  );
  const canRenderCamera = useMemo(
    () => isOpen && permissionState === 'granted' && !isBusy,
    [isBusy, isOpen, permissionState],
  );
  const showPermissionButton = useMemo(
    () => permissionState !== 'granted',
    [permissionState],
  );

  // 6. Callbacks (useCallback calling pure helpers)
  const handleRequestPermission = useCallback(async () => {
    await requestPermission();
  }, [requestPermission]);

  const handleBarcodeScanned = useCallback(
    (event: SetupQrScanEvent) => {
      if (!isOpen || isBusy) {
        return;
      }

      if (shouldIgnoreSetupQrScan(acceptedScanValueRef.current, event.data)) {
        return;
      }

      const normalizedValue = event.data.trim();
      acceptedScanValueRef.current = normalizedValue;
      onScan(normalizedValue);
    },
    [isBusy, isOpen, onScan],
  );

  const handleClose = useCallback(() => {
    acceptedScanValueRef.current = null;
    onClose();
  }, [onClose]);

  // 7. Effects
  useEffect(() => {
    if (!isOpen) {
      acceptedScanValueRef.current = null;
    }
  }, [isOpen]);

  return {
    canRenderCamera,
    isOpen,
    permissionMessage,
    permissionState,
    showPermissionButton,
    handleBarcodeScanned,
    handleClose,
    handleRequestPermission,
  };
}
