import {
  BridgeTimeoutError,
  BridgeUnreachableError,
} from './bridge-client.errors';
import {
  BRIDGE_API_PATHS,
  BRIDGE_REQUEST_TIMEOUT_MS,
  NOOP_BRIDGE_LOGGER,
} from './bridge-client.constants';
import {
  buildPostActiveSeasonRatingBody,
  buildBridgeHeaders,
  buildBridgeUrl,
  buildBridgeWebSocketUrl,
  parseBridgeResponseBody,
  parseRetryAfterMs,
} from './bridge-url.helpers';
import type {
  BridgeClient,
  BridgeClientDependencies,
  BridgeConnection,
  BridgeHttpResult,
  BridgePairDeviceRequest,
  PostActiveSeasonRatingRequest,
  BridgeRequestOptions,
  BridgeRequestSpec,
} from './bridge-client.types';


/**
 * Opens the default bridge WebSocket. React Native accepts a 3-argument constructor form that
 * carries auth headers, which the browser API does not expose, so the cast is deliberate.
 */
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

    // A request with no bound is the first half of H06h: nothing below it can report, and the
    // host job is killed at its runtime limit rather than completing. The controller and the
    // timer are owned here (not `AbortSignal.timeout()`) so fake timers can drive them in a test.
    const timeoutMs = spec.timeoutMs ?? BRIDGE_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);

    init.signal = controller.signal;

    let response: Response;
    try {
      response = await resolveFetch()(url, init);
    } catch (reason) {
      if (didTimeout) {
        logger.warn('[BridgeClient] request exceeded its budget', {
          url,
          method: spec.method,
          timeoutMs,
        });
        throw new BridgeTimeoutError(url, timeoutMs);
      }

      logger.warn('[BridgeClient] request did not reach the bridge', {
        url,
        method: spec.method,
      });
      throw new BridgeUnreachableError(url, reason);
    } finally {
      clearTimeout(timer);
    }

    const rawBody = typeof response.text === 'function' ? await response.text() : null;
    const data = parseBridgeResponseBody(rawBody);
    // Defensive read (Decision 8): production `Response` always has `headers`, but several test
    // doubles across this codebase (`tests/support/fake-bridge.helpers.ts`, this file's own
    // `buildResponse` fixtures) do not carry one. An unguarded `.get()` call throws against them.
    const retryAfterHeader =
      typeof response.headers?.get === 'function' ? response.headers.get('Retry-After') : null;
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader, Date.now());

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
      retryAfterMs,
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
    reconcile: (connection, body, options?: BridgeRequestOptions) =>
      request(connection, {
        method: 'POST',
        path: BRIDGE_API_PATHS.reconcile,
        token: connection.token,
        body,
        timeoutMs: options?.timeoutMs,
      }),
    postSyncDiagnostics: (connection, envelope, options?: BridgeRequestOptions) =>
      request(connection, {
        method: 'POST',
        path: BRIDGE_API_PATHS.syncDiagnostics,
        token: connection.token,
        body: envelope,
        timeoutMs: options?.timeoutMs,
      }),
    openWebSocket: (connection) =>
      createWebSocket(buildBridgeWebSocketUrl(connection), connection.token),
  };
}
