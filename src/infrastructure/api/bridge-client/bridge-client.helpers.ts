import { BRIDGE_API_PATHS, NOOP_BRIDGE_LOGGER } from './bridge-client.constants';
import {
  buildPostActiveSeasonRatingBody,
  buildBridgeHeaders,
  buildBridgeUrl,
  buildBridgeWebSocketUrl,
  parseBridgeResponseBody,
} from './bridge-url.helpers';
import type {
  BridgeClient,
  BridgeClientDependencies,
  BridgeConnection,
  BridgeHttpResult,
  BridgePairDeviceRequest,
  PostActiveSeasonRatingRequest,
  BridgeRequestSpec,
} from './bridge-client.types';

/**
 * Raised when the bridge cannot be reached at all (DNS/connection/timeout), as opposed to an
 * HTTP error response. Callers use this to treat the failure as transient (retry) rather than
 * a permanent contract rejection.
 */
export class BridgeUnreachableError extends Error {
  readonly url: string;
  readonly reason: unknown;

  constructor(url: string, reason: unknown) {
    super(`Bridge unreachable at ${url}`);
    this.name = 'BridgeUnreachableError';
    this.url = url;
    this.reason = reason;
  }
}

function defaultCreateWebSocket(url: string, token?: string): WebSocket {
  const options = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
  // React Native supports a 3-arg WebSocket(url, protocols, options) form for auth headers.
  const WebSocketCtor = WebSocket as unknown as {
    new (url: string, protocols: string | null, options?: unknown): WebSocket;
  };

  return new WebSocketCtor(url, null, options);
}

/**
 * Creates the single bridge adapter every feature consumes. The transport (`fetch`), the socket
 * factory, and the logger are injectable so the adapter stays testable and the dirty world never
 * leaks into feature code.
 */
export function createBridgeClient(
  dependencies: BridgeClientDependencies = {},
): BridgeClient {
  const logger = dependencies.logger ?? NOOP_BRIDGE_LOGGER;
  const createWebSocket = dependencies.createWebSocket ?? defaultCreateWebSocket;
  const resolveFetch = (): typeof fetch => dependencies.fetchFn ?? globalThis.fetch;

  async function request(
    connection: BridgeConnection,
    spec: BridgeRequestSpec,
  ): Promise<BridgeHttpResult> {
    const url = buildBridgeUrl(connection, spec.path);
    const hasBody = spec.body !== undefined;
    const init: RequestInit = {
      method: spec.method,
      headers: buildBridgeHeaders({ token: spec.token, hasBody }),
    };

    if (hasBody) {
      init.body = JSON.stringify(spec.body);
    }

    let response: Response;
    try {
      response = await resolveFetch()(url, init);
    } catch (reason) {
      logger.warn('[BridgeClient] request did not reach the bridge', {
        url,
        method: spec.method,
      });
      throw new BridgeUnreachableError(url, reason);
    }

    const rawBody = typeof response.text === 'function' ? await response.text() : null;
    const data = parseBridgeResponseBody(rawBody);

    logger.debug('[BridgeClient] response', {
      url,
      method: spec.method,
      status: response.status,
    });

    return {
      ok: response.ok,
      status: response.status,
      data,
      rawBody,
      url,
    };
  }

  return {
    pairDevice: (connection, pairRequest: BridgePairDeviceRequest) =>
      request(connection, {
        method: 'POST',
        path: BRIDGE_API_PATHS.pairDevice,
        body: {
          pairing_token: pairRequest.pairingToken,
          device_name: pairRequest.deviceName,
        },
      }),
    listAnimes: (connection) =>
      request(connection, {
        method: 'GET',
        path: BRIDGE_API_PATHS.animes,
        token: connection.token,
      }),
    getActiveSeason: (connection) =>
      request(connection, {
        method: 'GET',
        path: BRIDGE_API_PATHS.activeSeason,
        token: connection.token,
      }),
    postActiveSeasonRating: (
      connection,
      seasonRatingRequest: PostActiveSeasonRatingRequest,
    ) =>
      request(connection, {
        method: 'POST',
        path: BRIDGE_API_PATHS.activeSeasonRating,
        token: connection.token,
        body: buildPostActiveSeasonRatingBody(seasonRatingRequest),
      }),
    reconcile: (connection, body) =>
      request(connection, {
        method: 'POST',
        path: BRIDGE_API_PATHS.reconcile,
        token: connection.token,
        body,
      }),
    openWebSocket: (connection) =>
      createWebSocket(buildBridgeWebSocketUrl(connection), connection.token),
  };
}

/** Shared bridge client instance used across the app; backed by the global `fetch`/`WebSocket`. */
export const bridgeClient: BridgeClient = createBridgeClient();
