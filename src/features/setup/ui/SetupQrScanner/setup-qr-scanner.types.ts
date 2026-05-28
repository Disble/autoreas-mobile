export interface SetupQrScannerProps {
  readonly isBusy: boolean;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onScan: (rawValue: string) => void;
}

export interface SetupQrPermissionSnapshot {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
}

export interface SetupQrScanEvent {
  readonly data: string;
}

export type SetupQrPermissionState = 'loading' | 'granted' | 'requestable' | 'denied';

export interface SetupQrScannerViewModel {
  readonly canRenderCamera: boolean;
  readonly isOpen: boolean;
  readonly permissionMessage: string;
  readonly permissionState: SetupQrPermissionState;
  readonly showPermissionButton: boolean;
  readonly handleBarcodeScanned: (event: SetupQrScanEvent) => void;
  readonly handleClose: () => void;
  readonly handleRequestPermission: () => Promise<void>;
}
