import type { PairDeviceResult, PairParams } from '../../pair-device.types';

/** Defines the setup screen props value shape. */
export type SetupScreenProps = Record<never, never>;

/** Defines the data contract for bridge pairing payload. */
export interface BridgePairingPayload {
  readonly version: '1';
  readonly ip: string;
  readonly port: string;
  readonly token: string;
}

/** Defines the data contract for setup screen form state. */
export interface SetupScreenFormState {
  readonly ip: string;
  readonly port: string;
  readonly token: string;
}

/** Defines the setup pairing source value shape. */
export type SetupPairingSource = 'manual' | 'deep-link' | 'qr';

/** Defines the data contract for setup source feedback. */
export interface SetupSourceFeedback {
  readonly label: string;
  readonly description: string;
}

/** Defines the data contract for setup screen view model. */
export interface SetupScreenViewModel extends SetupScreenFormState {
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isScannerVisible: boolean;
  readonly setIp: (value: string) => void;
  readonly setPort: (value: string) => void;
  readonly setToken: (value: string) => void;
  readonly handlePair: () => void;
  readonly handleCloseScanner: () => void;
  readonly handleQrScan: (rawValue: string) => void;
  readonly handleToggleScanner: () => void;
}

/** Defines the setup pair submit params value shape. */
export type SetupPairSubmitParams = PairParams;
/** Defines the setup pair submit result value shape. */
export type SetupPairSubmitResult = PairDeviceResult;
