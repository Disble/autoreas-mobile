/** Defines the data contract for setup qr scanner props. */
export interface SetupQrScannerProps {
  readonly isBusy: boolean;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onScan: (rawValue: string) => void;
}

/** Defines the data contract for setup qr permission snapshot. */
export interface SetupQrPermissionSnapshot {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
}

/** Defines the data contract for setup qr scan event. */
export interface SetupQrScanEvent {
  readonly data: string;
}

/** Defines the setup qr permission state value shape. */
export type SetupQrPermissionState = 'loading' | 'granted' | 'requestable' | 'denied';

/** Defines the data contract for setup qr scanner view model. */
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
