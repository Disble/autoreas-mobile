import type { BridgeConnectionConfig } from '../sync/initial-sync.types';

/** Defines the data contract for pair params. */
export interface PairParams {
  readonly ip: string;
  readonly port: number | string;
  readonly token: string;
}

/** Defines the data contract for pair response. */
export interface PairResponse {
  readonly device_id: string;
  readonly device_name?: string | null;
  readonly auth_token: string;
}

/** Defines the data contract for pairing draft. */
export interface PairingDraft {
  readonly bridgeConfig: BridgeConnectionConfig;
  readonly response: PairResponse;
}

/** Defines the data contract for pair device success result. */
export interface PairDeviceSuccessResult {
  readonly success: true;
  readonly data: PairResponse;
}

/** Defines the data contract for pair device failure result. */
export interface PairDeviceFailureResult {
  readonly success: false;
  readonly error: string;
}

/** Defines the pair device result value shape. */
export type PairDeviceResult = PairDeviceSuccessResult | PairDeviceFailureResult;
