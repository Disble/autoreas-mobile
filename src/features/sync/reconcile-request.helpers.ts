import type { OperationLogRow } from '../../infrastructure/db/schema';
import { buildOptimisticBaseKey } from './reconcile-base-token.helpers';

/**
 * Builds the reconcile request body from persisted operation-log rows.
 * Keeping this serialization pure makes the network workflow easier to test and evolve. The JS
 * body carries no `client_telemetry` key.
 *
 * `bridgeTokensByAnimeId` (Part 2, Requirement 9) is optional and defaults to omitted: without it
 * every operation's `base` key is omitted, byte-identical to Part 1. When supplied, each
 * operation's `base` is built via `buildOptimisticBaseKey` from that anime's stored token --
 * present (including `0`) whenever the token is known, omitted only when it is `NULL`/absent from
 * the map.
 */
export function buildReconcileRequestBody(
  deviceId: string | undefined,
  lastChangelogId: number,
  pendingOperations: OperationLogRow[],
  bridgeTokensByAnimeId?: ReadonlyMap<string, number | null>,
) {
  return {
    device_id: deviceId ?? undefined,
    last_changelog_id: lastChangelogId,
    pending_operations: pendingOperations.map((operation) => ({
      anime_id: operation.animeId,
      operation: operation.operation,
      payload: normalizePendingOperationPayload(operation.operation, operation.payload),
      created_at: operation.createdAt,
      ...buildOptimisticBaseKey(bridgeTokensByAnimeId?.get(operation.animeId) ?? null),
    })),
  };
}

/**
 * Parses one persisted outbox payload into the bridge-facing reconcile shape.
 * This keeps legacy Spanish SQLite/domain names local while transport always emits English keys.
 *
 * Exported so `reconcile-confirmation.helpers.ts` can normalize the same stored payload when it
 * falls back to inferring confirmation from `bridge_changes` -- both call sites must derive the
 * bridge-facing shape identically, or a payload that reconciles here could fail to confirm there.
 */
export function normalizePendingOperationPayload(
  operation: string,
  payload: string,
): Record<string, unknown> {
  const parsedPayload = parseOperationPayload(payload);

  if (operation !== 'update') {
    return parsedPayload;
  }

  return normalizeLegacyAnimeUpdatePayloadAliases(parsedPayload);
}

/**
 * Reads one persisted payload column, which is free-form TEXT and therefore untrusted.
 * Anything that is not a JSON object -- corrupt text, a bare array, a scalar -- degrades to an
 * empty object instead of throwing, because a single bad row must not abort the whole cycle for
 * every other pending operation in the batch.
 */
function parseOperationPayload(payload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload) as unknown;

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

/**
 * Translates the legacy Spanish keys still written into local outbox payloads into the English
 * keys the wire contract accepts. The alias is always DELETED, even when no translation happened,
 * so a legacy name can never reach the bridge and be stored verbatim. An English key already
 * present wins over its alias: the caller that wrote it spoke the current contract on purpose.
 */
function normalizeLegacyAnimeUpdatePayloadAliases(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const normalizedPayload = { ...payload };

  const legacyAnimePayloadAliases = {
    estado: 'status',
    nrocapvisto: 'episodesWatched',
    fechaUltCapVisto: 'lastWatchedAt',
    dias: 'days',
  } as const;

  for (const legacyAlias of Object.keys(
    legacyAnimePayloadAliases,
  ) as (keyof typeof legacyAnimePayloadAliases)[]) {
    const englishKey = legacyAnimePayloadAliases[legacyAlias];

    if (!(englishKey in normalizedPayload) && legacyAlias in payload) {
      normalizedPayload[englishKey] = payload[legacyAlias];
    }

    delete normalizedPayload[legacyAlias];
  }

  return normalizedPayload;
}
