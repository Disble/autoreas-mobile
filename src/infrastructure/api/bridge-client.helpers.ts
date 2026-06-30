import {
  BRIDGE_API_PATHS,
  BRIDGE_HTTP_SCHEME,
  BRIDGE_WS_SCHEME,
} from './bridge-client.constants';
import type { BridgeConnection } from './bridge-client.types';

/**
 * Builds the `http://ip:port` origin for a bridge connection.
 * Centralizing origin construction keeps every feature on the same base URL contract.
 */
export function buildBridgeBaseUrl(connection: BridgeConnection): string {
  return `${BRIDGE_HTTP_SCHEME}://${connection.ip}:${connection.port}`;
}

/**
 * Joins the bridge origin with an API path into an absolute request URL.
 * Using one joiner prevents the duplicated string templates the features used to carry.
 */
export function buildBridgeUrl(connection: BridgeConnection, path: string): string {
  return `${buildBridgeBaseUrl(connection)}${path}`;
}

/**
 * Builds the realtime `ws://ip:port/ws` URL for a bridge connection.
 * Keeps the websocket scheme/path in one place alongside the HTTP origin logic.
 */
export function buildBridgeWebSocketUrl(connection: BridgeConnection): string {
  return `${BRIDGE_WS_SCHEME}://${connection.ip}:${connection.port}${BRIDGE_API_PATHS.ws}`;
}

/**
 * Builds request headers, adding `Content-Type` only for bodies and `Authorization` only when a
 * token is present. This mirrors the exact header shape each bridge endpoint expects.
 */
export function buildBridgeHeaders(options: {
  readonly token?: string;
  readonly hasBody: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {};

  if (options.hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  return headers;
}

/**
 * Extracts the bridge-owned season-mode flag from a parsed GET /api/status body.
 * Defaults to false for any missing or malformed shape so a partial, legacy, or
 * error status payload can never flip the client into season mode by accident —
 * false is the canonical default (it mirrors the bridge's missing-row sentinel).
 */
export function extractSeasonMode(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  return (data as { season_mode?: unknown }).season_mode === true;
}

/**
 * Best-effort JSON parse of an already-read response body.
 * Returns null for empty or non-JSON bodies so callers never read the stream twice.
 */
export function parseBridgeResponseBody(rawBody: string | null): unknown {
  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}
