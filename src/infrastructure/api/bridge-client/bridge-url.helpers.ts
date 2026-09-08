import {
  BRIDGE_API_PATHS,
  BRIDGE_HTTP_SCHEME,
  BRIDGE_WS_SCHEME,
  SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS,
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
function buildBridgeBaseUrl(connection: BridgeConnection): string {
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
 * Parses a bridge response's `Retry-After` header value into a milliseconds delay, or `null`
 * when no server-directed backoff should be honored (Decision 2).
 *
 * Delta-seconds (RFC 9110 SS10.2.3, e.g. `"120"`) is tried FIRST and matched strictly against
 * `/^\d+$/`. `Date.parse('2000')` yields a valid year-2000 date in V8/Hermes, so a legitimate
 * 2000-second delay would silently become a 26-year backoff if the date branch ran first.
 *
 * `Date.parse` is only *specified* for ISO-8601; IMF-fixdate (HTTP-date) support is
 * implementation-defined, and V8 additionally accepts loose, non-standard fragments (measured:
 * `Date.parse('-5')` and `Date.parse('1.5')` both resolve to real dates instead of `NaN`). Every
 * valid RFC 9110 date form (IMF-fixdate, obsolete RFC 850, and asctime) carries an `HH:MM:SS`
 * time-of-day, so requiring a colon before calling `Date.parse` rejects that lenient
 * misparsing without narrowing which real dates are accepted. The bridge contract sends
 * delta-seconds; the date branch is defensive, not relied upon.
 */
export function parseRetryAfterMs(rawValue: string | null, now: number): number | null {
  if (rawValue === null) {
    return null;
  }

  const trimmed = rawValue.trim();

  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1_000, SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS);
  }

  if (!trimmed.includes(':')) {
    return null;
  }

  const parsedDate = Date.parse(trimmed);

  if (Number.isNaN(parsedDate)) {
    return null;
  }

  return Math.min(Math.max(parsedDate - now, 0), SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS);
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

/**
 * Normalizes one wire season candidate into the snapshot shape features consume, returning null
 * for anything that is not a usable object so a malformed entry is skipped rather than fatal.
 */
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
