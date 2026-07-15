/** Network coordinates (and optional auth token) for a paired bridge. */
export interface BridgeConnection {
  readonly ip: string;
  readonly port: number;
  readonly token?: string;
}

/** Body fields required by the bridge `/api/devices/pair` contract. */
export interface BridgePairDeviceRequest {
  readonly pairingToken: string;
  readonly deviceName: string;
}

/** Bridge-owned rating source displayed on season-aware candidate surfaces. */
export type ActiveSeasonRatingSource = 'bridge';

/** One bridge-declared season candidate after transport normalization. */
export interface ActiveSeasonCandidateSnapshot {
  readonly animeId: string;
  readonly bridgeRating: number | null;
  readonly bridgeRatingSource: ActiveSeasonRatingSource | null;
}

/** Active-season snapshot consumed by features without exposing raw wire keys. */
export interface ActiveSeasonSnapshot {
  readonly seasonId: string;
  readonly candidates: readonly ActiveSeasonCandidateSnapshot[];
  readonly candidatesByAnimeId: Readonly<Record<string, ActiveSeasonCandidateSnapshot>>;
}

/** Body fields required by the bridge active-season rating contract. */
export interface PostActiveSeasonRatingRequest {
  readonly animeId: string;
  readonly nota: number;
  readonly ratedAt: number;
}

/** Defines the bridge http method value shape. */
export type BridgeHttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Low-level description of a single bridge HTTP request. */
export interface BridgeRequestSpec {
  readonly method: BridgeHttpMethod;
  readonly path: string;
  readonly token?: string;
  readonly body?: unknown;
}

/** Normalized result of a bridge HTTP request, body read exactly once. */
export interface BridgeHttpResult {
  readonly ok: boolean;
  readonly status: number;
  readonly data: unknown;
  readonly rawBody: string | null;
  readonly url: string;
}

/** Minimal diagnostic logger seam consumed by the bridge client. */
export interface BridgeClientLogger {
  readonly debug: (message: string, context?: Record<string, unknown>) => void;
  readonly warn: (message: string, context?: Record<string, unknown>) => void;
}

/** Injectable collaborators for the bridge client (transport, sockets, logging). */
export interface BridgeClientDependencies {
  readonly fetchFn?: typeof fetch;
  readonly createWebSocket?: (url: string, token?: string) => WebSocket;
  readonly logger?: BridgeClientLogger;
}

/** The single adapter every feature uses to talk to the bridge over HTTP/WS. */
export interface BridgeClient {
  readonly resolveBaseUrl: (connection: BridgeConnection) => string;
  readonly resolveWebSocketUrl: (connection: BridgeConnection) => string;
  readonly request: (
    connection: BridgeConnection,
    spec: BridgeRequestSpec,
  ) => Promise<BridgeHttpResult>;
  readonly pairDevice: (
    connection: BridgeConnection,
    request: BridgePairDeviceRequest,
  ) => Promise<BridgeHttpResult>;
  readonly listAnimes: (connection: BridgeConnection) => Promise<BridgeHttpResult>;
  readonly getAnime: (
    connection: BridgeConnection,
    animeId: string,
  ) => Promise<BridgeHttpResult>;
  readonly getStatus: (connection: BridgeConnection) => Promise<BridgeHttpResult>;
  readonly getActiveSeason: (connection: BridgeConnection) => Promise<BridgeHttpResult>;
  readonly postActiveSeasonRating: (
    connection: BridgeConnection,
    request: PostActiveSeasonRatingRequest,
  ) => Promise<BridgeHttpResult>;
  readonly reconcile: (
    connection: BridgeConnection,
    body: unknown,
  ) => Promise<BridgeHttpResult>;
  readonly openWebSocket: (connection: BridgeConnection) => WebSocket;
}
