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
  readonly reconcile: (
    connection: BridgeConnection,
    body: unknown,
  ) => Promise<BridgeHttpResult>;
  readonly openWebSocket: (connection: BridgeConnection) => WebSocket;
}
