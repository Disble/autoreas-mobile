import {
  BRIDGE_API_PATHS,
  BRIDGE_HTTP_SCHEME,
  BRIDGE_WS_SCHEME,
} from './bridge-client.constants';
import type {
  ActiveSeasonCandidateSnapshot,
  ActiveSeasonSnapshot,
  BridgeConnection,
  PostActiveSeasonRatingRequest,
} from './bridge-client.types';

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
 * Extracts the active-season snapshot from a bridge response body and drops malformed entries.
 * Candidate membership comes ONLY from the bridge `candidates` array so mobile never infers it locally.
 */
export function extractActiveSeasonSnapshot(data: unknown): ActiveSeasonSnapshot | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const seasonId = (data as { season_id?: unknown }).season_id;
  const rawCandidates = (data as { candidates?: unknown }).candidates;

  if (typeof seasonId !== 'string' || !Array.isArray(rawCandidates)) {
    return null;
  }

  const candidates = rawCandidates
    .map(mapActiveSeasonCandidate)
    .filter((candidate): candidate is ActiveSeasonCandidateSnapshot => candidate !== null);

  return {
    seasonId,
    candidates,
    candidatesByAnimeId: Object.freeze(
      candidates.reduce<Record<string, ActiveSeasonCandidateSnapshot>>((accumulator, candidate) => {
        accumulator[candidate.animeId] = candidate;
        return accumulator;
      }, {}),
    ),
  };
}

/**
 * Serializes a normalized season-rating request into the exact bridge wire contract.
 * Features can stay camelCase while the adapter remains the only place that owns transport keys.
 */
export function buildPostActiveSeasonRatingBody(
  request: PostActiveSeasonRatingRequest,
): Record<string, number | string> {
  return {
    anime_id: request.animeId,
    grade: request.nota,
    rated_at: request.ratedAt,
  };
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

function mapActiveSeasonCandidate(candidate: unknown): ActiveSeasonCandidateSnapshot | null {
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }

  const animeId = (candidate as { anime_id?: unknown }).anime_id;
  const grade = (candidate as { grade?: unknown }).grade;
  const gradeSource = (candidate as { grade_source?: unknown }).grade_source;

  if (typeof animeId !== 'string' || animeId.length === 0) {
    return null;
  }

  return {
    animeId,
    bridgeRating: typeof grade === 'number' ? grade : null,
    bridgeRatingSource: gradeSource === 'bridge' ? 'bridge' : null,
  };
}
