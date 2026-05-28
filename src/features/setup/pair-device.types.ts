import type { BridgeConnectionConfig } from '../sync/initial-sync.types';

export interface PairParams {
  readonly ip: string;
  readonly port: number | string;
  readonly token: string;
}

export interface PairResponse {
  readonly device_id: string;
  readonly device_name?: string | null;
  readonly auth_token: string;
}

export interface PairingDraft {
  readonly bridgeConfig: BridgeConnectionConfig;
  readonly response: PairResponse;
}

export interface PairDeviceSuccessResult {
  readonly success: true;
  readonly data: PairResponse;
}

export interface PairDeviceFailureResult {
  readonly success: false;
  readonly error: string;
}

export type PairDeviceResult = PairDeviceSuccessResult | PairDeviceFailureResult;
