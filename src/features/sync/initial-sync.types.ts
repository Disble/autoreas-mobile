/** Defines the data contract for bridge connection config. */
export interface BridgeConnectionConfig {
  readonly ip: string;
  readonly port: number;
  readonly token: string;
  readonly deviceId: string;
  readonly deviceName: string;
}

/** Defines the data contract for bridge fetch credentials. */
export interface BridgeFetchCredentials {
  readonly ip: string;
  readonly port: number;
  readonly token: string;
}

