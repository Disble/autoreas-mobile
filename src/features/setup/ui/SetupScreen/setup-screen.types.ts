import type { PairDeviceResult, PairParams } from '../../pair-device.types';

export type SetupScreenProps = Record<never, never>;

export interface BridgePairingPayload {
  readonly version: '1';
  readonly ip: string;
  readonly port: string;
  readonly token: string;
}

export interface SetupScreenFormState {
  readonly ip: string;
  readonly port: string;
  readonly token: string;
}

export type SetupPairingSource = 'manual' | 'deep-link' | 'qr';

export interface SetupSourceFeedback {
  readonly label: string;
  readonly description: string;
}

export interface SetupScreenViewModel extends SetupScreenFormState {
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isScannerVisible: boolean;
  readonly setIp: (value: string) => void;
  readonly setPort: (value: string) => void;
  readonly setToken: (value: string) => void;
  readonly handlePair: () => Promise<void>;
  readonly handleCloseScanner: () => void;
  readonly handleQrScan: (rawValue: string) => void;
  readonly handleToggleScanner: () => void;
}

export type SetupPairSubmitParams = PairParams;
export type SetupPairSubmitResult = PairDeviceResult;
