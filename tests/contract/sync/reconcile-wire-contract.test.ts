import { buildReconcileRequestBody } from '../../../src/features/sync/reconcile-request.helpers';
import { ReconcileResponseSchema } from '../../../src/features/sync/reconcile.schema';
import { getConfirmedOperationIds } from '../../../src/features/sync/reconcile-confirmation.helpers';
import {
  mapWireAnimeToLegacyAnime,
  normalizeWireAnimeChangedFields,
} from '../../../src/infrastructure/validation/anime-schema/anime-wire.helpers';
import type { OperationLogRow } from '../../../src/infrastructure/db/schema';
import type { WireSyncCycleTelemetry } from '../../../src/features/sync/sync-telemetry.types';
import type { ReconcileAppliedOperation, ReconcileAnimeChange } from '../../../src/features/sync/reconcile.schema';

/**
 * Shared golden-fixture contract between this JS engine and the Kotlin engine
 * (`modules/sync-engine/android/src/test/java/expo/modules/syncengine/ReconcileWireContractTest.kt`).
 * Both suites read the SAME JSON files under `tests/fixtures/sync-contract/` and run them through
 * their own language's production functions, so a change that makes one engine disagree with the
 * other fails a test on the side that drifted, instead of silently shipping two protocols.
 *
 * Normalized projection (documented once, here, per the task's Design point 4): a response case's
 * `bridgeChanges[]` compares `recordId`/`changeType`/`timestamp` verbatim, `changedFields` in the
 * LOCAL (Spanish) vocabulary via `normalizeWireAnimeChangedFields`, and `snapshot` mapped to the
 * legacy shape via `mapWireAnimeToLegacyAnime` (or `null` when the change carried none). A request
 * case's `expectedTelemetryProjection`, when present, compares only `cycle_id`/`trigger_source`/
 * `counters.pending_ops_count` -- the fields both engines' `client_telemetry` envelopes actually
 * share. The two envelopes otherwise differ on purpose (JS forwards a caller-supplied
 * `WireSyncCycleTelemetry`; Kotlin always builds its own deliberately minimal one -- see
 * `ReconcileRequestBody.kt`'s header comment; unifying them is T5, not T2), so full-shape equality
 * across languages is never asserted for that field.
 */

/** One pending-operation-log fixture row, widened to a real `OperationLogRow` for the helpers. */
function toOperationLogRow(row: {
  id: number;
  animeId: string;
  operation: string;
  payload: string;
  createdAt?: number;
}): OperationLogRow {
  return {
    id: row.id,
    animeId: row.animeId,
    operation: row.operation,
    payload: row.payload,
    status: 'processing',
    createdAt: row.createdAt ?? 0,
  } as OperationLogRow;
}

/** One request-contract fixture case, as stored in `reconcile-request-cases.json`. */
interface RequestCase {
  name: string;
  input: {
    deviceId: string;
    lastChangelogId: number;
    pendingOperations: { id: number; animeId: string; operation: string; payload: string; createdAt: number }[];
    bridgeTokensByAnimeId?: Record<string, number | null>;
    clientTelemetry?: WireSyncCycleTelemetry;
  };
  expected: {
    device_id: string;
    last_changelog_id: number;
    pending_operations: { anime_id: string; operation: string; payload: Record<string, unknown>; created_at: number; base?: number }[];
  };
  expectedTelemetryProjection?: { cycle_id: string; trigger_source: string; counters: { pending_ops_count: number } };
}

describe('reconcile request wire contract (shared fixtures)', () => {
  const cases = require('../../fixtures/sync-contract/reconcile-request-cases.json') as RequestCase[];

  it.each(cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
    const rows = testCase.input.pendingOperations.map(toOperationLogRow);
    const tokenMap = testCase.input.bridgeTokensByAnimeId
      ? new Map(Object.entries(testCase.input.bridgeTokensByAnimeId))
      : undefined;

    const body = buildReconcileRequestBody(
      testCase.input.deviceId,
      testCase.input.lastChangelogId,
      rows,
      testCase.input.clientTelemetry,
      tokenMap,
    );

    expect(body.device_id).toBe(testCase.expected.device_id);
    expect(body.last_changelog_id).toBe(testCase.expected.last_changelog_id);
    expect(body.pending_operations).toEqual(testCase.expected.pending_operations);

    if (testCase.expectedTelemetryProjection) {
      const telemetry = (body as { client_telemetry?: WireSyncCycleTelemetry }).client_telemetry;
      expect(telemetry?.cycle_id).toBe(testCase.expectedTelemetryProjection.cycle_id);
      expect(telemetry?.trigger_source).toBe(testCase.expectedTelemetryProjection.trigger_source);
      expect(telemetry?.counters.pending_ops_count).toBe(
        testCase.expectedTelemetryProjection.counters.pending_ops_count,
      );
    }
  });
});

/** One backlog-row fixture entry, as stored in a response/rejection/divergence fixture case. */
interface BacklogFixtureRow {
  id: number;
  animeId: string;
  operation: string;
  payload: string;
}

/** One normalized bridge change, in the shape both engines' fixtures compare against. */
interface NormalizedBridgeChangeResult {
  recordId: string;
  changeType: string;
  changedFields: string[];
  snapshot: Record<string, unknown> | null;
  timestamp: number;
}

/** The outcome of running one response fixture case through the JS pipeline. */
type ResponseCaseResult =
  | { rejected: true }
  | {
      rejected: false;
      lastChangelogId: number | undefined;
      confirmedOperationIds: number[];
      bridgeChanges: NormalizedBridgeChangeResult[];
    };

/**
 * Runs one response fixture case through the full JS pipeline: schema parse, confirmation, and
 * wire-to-legacy normalization -- the same three concerns
 * `ReconcileResponseParser`/`ReconcileConfirmation`/`WireAnimeMapper` cover together on the
 * Kotlin side. Any parse failure anywhere in the pipeline is reported as `rejected`.
 */
function runResponseCase(input: { backlog: BacklogFixtureRow[]; responseBody: unknown }): ResponseCaseResult {
  const parsed = ReconcileResponseSchema.safeParse(input.responseBody);
  if (!parsed.success) {
    return { rejected: true };
  }

  const backlog = input.backlog.map(toOperationLogRow);
  const appliedOperations = parsed.data.applied_operations as ReconcileAppliedOperation[];
  const bridgeChanges = parsed.data.bridge_changes as ReconcileAnimeChange[];
  const confirmedOperationIds = getConfirmedOperationIds(backlog, appliedOperations, bridgeChanges);

  return {
    rejected: false,
    lastChangelogId: parsed.data.last_changelog_id,
    confirmedOperationIds,
    bridgeChanges: bridgeChanges.map((change) => ({
      recordId: change.record_id,
      changeType: change.change_type,
      changedFields: normalizeWireAnimeChangedFields(change.changed_fields),
      snapshot: change.snapshot ? mapWireAnimeToLegacyAnime(change.snapshot) : null,
      timestamp: change.timestamp,
    })),
  };
}

/** One response-contract fixture case, as stored in `reconcile-response-cases.json`. */
interface ResponseCase {
  name: string;
  input: { backlog: BacklogFixtureRow[]; responseBody: unknown };
  expected: {
    last_changelog_id?: number;
    confirmedOperationIds: number[];
    bridgeChanges: NormalizedBridgeChangeResult[];
  };
}

describe('reconcile response wire contract (shared fixtures)', () => {
  const cases = require('../../fixtures/sync-contract/reconcile-response-cases.json') as ResponseCase[];

  it.each(cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
    const result = runResponseCase(testCase.input);
    if (result.rejected) {
      throw new Error(`expected case to parse successfully, but it was rejected`);
    }

    if ('last_changelog_id' in testCase.expected) {
      expect(result.lastChangelogId).toBe(testCase.expected.last_changelog_id);
    } else {
      expect(result.lastChangelogId).toBeUndefined();
    }
    expect(result.confirmedOperationIds).toEqual(testCase.expected.confirmedOperationIds);
    expect(result.bridgeChanges).toEqual(testCase.expected.bridgeChanges);
  });
});

/** One rejection-contract fixture case, as stored in `reconcile-rejection-cases.json`. */
interface RejectionCase {
  name: string;
  input: { backlog: BacklogFixtureRow[]; responseBody: unknown };
}

describe('reconcile response wire contract -- both engines MUST reject (shared fixtures)', () => {
  const cases = require('../../fixtures/sync-contract/reconcile-rejection-cases.json') as RejectionCase[];

  it.each(cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
    expect(runResponseCase(testCase.input).rejected).toBe(true);
  });
});

/**
 * One documented-divergence fixture case, as stored in `reconcile-response-divergence-cases.json`.
 * See the Divergences section of `odd/tasks/sync-core-test-assurance.md`'s T2 report: each of
 * these is a real, evidenced disagreement between the two engines, deliberately NOT fixed here.
 * `expectedDivergence.js` pins this side's half of the disagreement; a future change that makes
 * JS agree with Kotlin (or vice versa) must edit this fixture and remove the divergence marker --
 * that is what makes the marker fail loudly instead of going stale silently.
 */
interface DivergenceCase {
  name: string;
  input: { backlog: BacklogFixtureRow[]; responseBody: unknown };
  expectedDivergence: { js: { rejected: boolean } };
}

describe('reconcile response wire contract -- documented JS/Kotlin divergences', () => {
  const cases = require('../../fixtures/sync-contract/reconcile-response-divergence-cases.json') as DivergenceCase[];

  it.each(cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
    const result = runResponseCase(testCase.input);
    expect(result.rejected).toBe(testCase.expectedDivergence.js.rejected);
  });
});
