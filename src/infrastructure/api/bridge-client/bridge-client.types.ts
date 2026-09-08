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
  /** Overrides the default request budget. Omitted means BRIDGE_REQUEST_TIMEOUT_MS. */
  readonly timeoutMs?: number;
}

/** Per-call overrides a caller may apply to one bridge request. */
export interface BridgeRequestOptions {
  readonly timeoutMs?: number;
}

/** Normalized result of a bridge HTTP request, body read exactly once. */
export interface BridgeHttpResult {
  readonly ok: boolean;
  readonly status: number;
  readonly data: unknown;
  readonly rawBody: string | null;
  readonly url: string;
  /** Parsed `Retry-After` delay in ms, or `null` when absent, unparseable, or not honored. */
  readonly retryAfterMs: number | null;
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
  readonly pairDevice: (
    connection: BridgeConnection,
    request: BridgePairDeviceRequest,
  ) => Promise<BridgeHttpResult>;
  readonly listAnimes: (connection: BridgeConnection) => Promise<BridgeHttpResult>;
  readonly getActiveSeason: (connection: BridgeConnection) => Promise<BridgeHttpResult>;
  readonly postActiveSeasonRating: (
    connection: BridgeConnection,
    request: PostActiveSeasonRatingRequest,
  ) => Promise<BridgeHttpResult>;
  readonly reconcile: (
    connection: BridgeConnection,
    body: unknown,
    options?: BridgeRequestOptions,
  ) => Promise<BridgeHttpResult>;
  /**
   * Delivers one diagnostics outbox entry's payload to the bridge. Storage-agnostic: the caller
   * owns the durable outbox (`sync-diagnostics-outbox`) and this method only performs the POST.
   */
  readonly postSyncDiagnostics: (
    connection: BridgeConnection,
    envelope: unknown,
    options?: BridgeRequestOptions,
  ) => Promise<BridgeHttpResult>;
  readonly openWebSocket: (connection: BridgeConnection) => WebSocket;
}
