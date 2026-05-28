import type { Anime } from '../../infrastructure/validation/anime-schema';

export interface BridgeConnectionConfig {
  readonly ip: string;
  readonly port: number;
  readonly token: string;
  readonly deviceId: string;
  readonly deviceName: string;
}

export interface BridgeFetchCredentials {
  readonly ip: string;
  readonly port: number;
  readonly token: string;
}

export interface InitialSyncSnapshot {
  readonly animes: readonly Anime[];
}
