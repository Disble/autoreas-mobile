import type { OperationLogRow } from '../../src/infrastructure/db/schema';
import { FIXTURE_EPOCH_MS, FIXTURE_SEQUENCE } from './sync-fixtures.constants';
import type {
  AnimeRowFixture,
  AppliedOperationFixture,
  OperationLogRowFixture,
  ReconcileResponseBodyOptions,
} from './sync-fixtures.types';

/** Returns the next unique suffix so two defaulted rows can coexist in the same table. */
function nextSequence(): number {
  FIXTURE_SEQUENCE.value += 1;

  return FIXTURE_SEQUENCE.value;
}

/**
 * Builds an `animes` row with every NOT NULL column defaulted to a schema-valid value, per the
 * production DDL (`_id`, `nombre`, `estado`, `nrocapvisto`, `activo`, `primeravez`). Defaults
 * mirror the column defaults the migration declares, so a fixture row and a row the app would
 * create are indistinguishable to a query.
 */
export function buildAnimeRow(overrides: Partial<AnimeRowFixture> = {}): AnimeRowFixture {
  const sequence = nextSequence();

  return {
    _id: `anime-${sequence}`,
    nombre: `Anime ${sequence}`,
    estado: 0,
    nrocapvisto: 0,
    activo: 1,
    primeravez: 1,
    ...overrides,
  };
}

/**
 * Builds an `operation_log` row, JSON-encoding `payload` exactly as the app does before it is
 * persisted. Accepting the payload as an object keeps test intent readable while the stored
 * shape stays faithful to production.
 */
export function buildOperationLogRow(
  overrides: Partial<Omit<OperationLogRowFixture, 'payload'>> & { payload?: unknown } = {},
): OperationLogRowFixture {
  const { payload, ...rest } = overrides;
  const sequence = nextSequence();

  return {
    anime_id: `anime-${sequence}`,
    operation: 'update',
    payload: JSON.stringify(payload ?? {}),
    status: 'pending',
    created_at: FIXTURE_EPOCH_MS + sequence,
    ...rest,
  };
}

/**
 * Builds an `operation_log` row in its Drizzle entity shape (camelCase), the shape helpers and
 * mocked queries hand around. Every column a later migration adds is defaulted HERE, so a schema
 * change touches one fixture instead of every suite that spells a row out by hand.
 */
export function buildOperationLogEntity(overrides: Partial<OperationLogRow> = {}): OperationLogRow {
  return {
    id: 1,
    animeId: 'anime-1',
    operation: 'update',
    payload: '{}',
    status: 'pending',
    createdAt: FIXTURE_EPOCH_MS,
    conflictAttemptCount: 0,
    claimOwner: null,
    claimedAt: null,
    unresolvedReason: null,
    ...overrides,
  };
}

/**
 * Builds one `applied_operations` entry. `applied` defaults to `true` because the interesting
 * default is a confirmed operation; a rejection is stated explicitly by the test that wants it.
 */
export function buildAppliedOperation(
  overrides: Partial<AppliedOperationFixture> = {},
): AppliedOperationFixture {
  return {
    anime_id: 'anime-1',
    operation: 'update',
    applied: true,
    ...overrides,
  };
}

/**
 * Builds a reconcile response body matching `ReconcileResponseSchema`. `applied_operations`
 * defaults to `[]` rather than being absent, mirroring the bridge's verified contract: the field
 * is always present and serializes as `[]`, never `null`.
 */
export function buildReconcileResponseBody(options: ReconcileResponseBodyOptions = {}) {
  return {
    status: options.status ?? 'ok',
    applied_operations: options.appliedOperations ?? [],
    bridge_changes: options.bridgeChanges ?? [],
    last_changelog_id: options.lastChangelogId,
  };
}
