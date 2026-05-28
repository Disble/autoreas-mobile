import {
  SETUP_QR_SCANNER_DENIED_MESSAGE,
  SETUP_QR_SCANNER_LOADING_MESSAGE,
  SETUP_QR_SCANNER_READY_MESSAGE,
  SETUP_QR_SCANNER_REQUESTABLE_MESSAGE,
} from './setup-qr-scanner.constants';
import type {
  SetupQrPermissionSnapshot,
  SetupQrPermissionState,
} from './setup-qr-scanner.types';

/**
 * Resolves the scanner permission state from Expo's permission snapshot.
 * The hook consumes this stable mapping so UI branches stay deterministic and easy to test.
 */
export function getSetupQrScannerPermissionState(
  permission: SetupQrPermissionSnapshot | null,
): SetupQrPermissionState {
  if (!permission) {
    return 'loading';
  }

  if (permission.granted) {
    return 'granted';
  }

  return permission.canAskAgain ? 'requestable' : 'denied';
}

/**
 * Builds the user-facing camera permission message for the current scanner state.
 * This keeps permission copy out of the hook so denied and requestable states stay reusable.
 */
export function getSetupQrScannerPermissionMessage(
  permissionState: SetupQrPermissionState,
): string {
  switch (permissionState) {
    case 'granted':
      return SETUP_QR_SCANNER_READY_MESSAGE;
    case 'requestable':
      return SETUP_QR_SCANNER_REQUESTABLE_MESSAGE;
    case 'denied':
      return SETUP_QR_SCANNER_DENIED_MESSAGE;
    default:
      return SETUP_QR_SCANNER_LOADING_MESSAGE;
  }
}

/**
 * Ignores empty scans and duplicate payloads emitted by the camera stream.
 * Expo can fire repeated QR callbacks for the same frame, so setup must accept only the first one.
 */
export function shouldIgnoreSetupQrScan(
  lastAcceptedValue: string | null,
  nextRawValue: string,
): boolean {
  const normalizedValue = nextRawValue.trim();

  return normalizedValue.length === 0 || normalizedValue === lastAcceptedValue;
}
