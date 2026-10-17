/**
 * The language-neutral shape of one shared contract fixture under `tests/contract-fixtures/`
 * (ADR 009 R-4, R-10). The JS runner (`tests/behaviour/sync/contract-fixtures.behaviour.test.ts`)
 * and the Kotlin runner (`SyncEngineContractFixtureTest.kt`) read the SAME files and assert the
 * same `expect` block, so behaviour both runtimes share is pinned once.
 */

/** A runtime a fixture runs in. Anime fixtures run in both; ratings are JS-only until T17. */
export type ContractRuntime = 'js' | 'kotlin';

/** What one attempt reported: the JS promise resolved or rejected, Kotlin `closed` or `failed`. */
export type ContractAttemptOutcome = 'succeeded' | 'failed';

/** One stored anime: its id and its bridge token (`null` when the device has none). */
export interface ContractAnime {
  readonly id: string;
  readonly token: number | null;
}

/** One queued `operation_log` row, oldest first; `operation` defaults to `update`. */
export interface ContractOutboxRow {
  readonly animeId: string;
  readonly operation?: string;
  readonly payload: Record<string, unknown>;
  readonly conflictAttemptCount?: number;
}

/** One queued season rating. */
export interface ContractRating {
  readonly seasonId: string;
  readonly animeId: string;
  readonly nota: number;
  readonly ratedAt: number;
}

/** The stored precondition: the cursor, the animes, the anime outbox and the rating queue. */
export interface ContractGiven {
  readonly cursor: number;
  readonly animes: readonly ContractAnime[];
  readonly outbox: readonly ContractOutboxRow[];
  readonly ratings?: readonly ContractRating[];
}

/** One scripted bridge answer: a status and a JSON body, or a refused connection. */
export type ContractBridgeStep =
  | { readonly status: number; readonly body: unknown }
  | { readonly transport: 'refused' };

/** One attempt: the answers the bridge gives, in order, and, when the ADR defines it, the outcome. */
export interface ContractCycle {
  readonly bridge: readonly ContractBridgeStep[];
  readonly attempt?: ContractAttemptOutcome;
}

/** One request the bridge answered, projected to the fields both runtimes share. */
export interface ContractRequest {
  readonly method: string;
  readonly path: string;
  readonly lastChangelogId?: number;
  readonly operations?: readonly Record<string, unknown>[];
  readonly body?: unknown;
}

/** One `operation_log` row as read back. */
export interface ContractOutboxState {
  readonly animeId: string;
  readonly status: string;
  readonly unresolvedReason: string | null;
  readonly claimOwner: string | null;
  readonly conflictAttemptCount: number;
}

/** One `season_rating_queue` row as read back. */
export interface ContractRatingState {
  readonly animeId: string;
  readonly status: string;
  readonly lastFailureKind: string | null;
}

/** The expected end state; only the keys a fixture names are compared. */
export interface ContractExpectation {
  readonly requests: readonly ContractRequest[];
  readonly outbox?: readonly ContractOutboxState[];
  readonly cursor?: number;
  readonly tokens?: Readonly<Record<string, number | null>>;
  readonly staged?: readonly string[];
  readonly ratings?: readonly ContractRatingState[];
}

/** One whole scenario file. `kind` is `season_rating` for rating fixtures, absent for anime ones. */
export interface ContractFixture {
  readonly name: string;
  readonly kind?: 'season_rating';
  readonly covers: readonly string[];
  readonly description: string;
  readonly runtimes: readonly ContractRuntime[];
  readonly given: ContractGiven;
  readonly cycles: readonly ContractCycle[];
  readonly expect: ContractExpectation;
}
