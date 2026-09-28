import type { ResetIntent } from './recovery.schema';

/**
 * Mirrors the startup failure vocabulary the reset decision reasons about.
 *
 * Declared locally rather than imported from the startup feature so the infrastructure recovery
 * module keeps no compile-time edge onto feature code (the wiring arrives later, in the other
 * direction). `reset-decision.test.ts` asserts this union stays mutually assignable with the
 * startup feature's `StartupFailureClassification`, so a new classification cannot silently
 * become an unhandled reset input.
 */
export type ResetDiagnosticClassification =
  | 'busy'
  | 'corruption'
  | 'incompatible_schema'
  | 'schema_validation'
  | 'sqlite'
  | 'unknown';

/**
 * Names every non-corruption classification, each of which must refuse a reset.
 *
 * `Exclude` rather than a hand-written list: adding a classification to
 * `ResetDiagnosticClassification` makes it a refusal reason automatically, so no classification can
 * default into the destructive path.
 */
export type ResetNonCorruptionClassification = Exclude<
  ResetDiagnosticClassification,
  'corruption'
>;

/**
 * Names every reason the reset boundary refuses to destroy the application database.
 *
 * Every value is a non-corruption startup classification, so a caller can render transient
 * guidance (`busy`), a repairable mismatch (`schema_validation`, `incompatible_schema`), or an
 * unclassified SQLite outcome (`sqlite`, `unknown`) without collapsing them into one generic
 * refusal. There is deliberately no availability or configuration prerequisite: a Bridge that is
 * off, or no stored configuration at all, must never block recovering a confirmed-corrupt
 * database -- pairing and snapshot happen AFTER the reset, never before it (correction, parent
 * review).
 */
export type ResetRefusalReason = ResetNonCorruptionClassification;

/**
 * Defines the explicit input the pure authorization decision consumes.
 *
 * The classification is the startup diagnostic's own verdict, and it is the ONLY field the
 * decision reads. There is deliberately no override, force, or confirmation field, and no
 * Bridge-availability or configuration field: authorization is derived from confirmed physical
 * corruption alone, never asserted by the caller and never gated on an external prerequisite.
 */
export interface ResetDecisionInput {
  readonly classification: ResetDiagnosticClassification;
}

/** Defines the pure answer to whether a startup diagnostic authorizes destruction. */
export type ResetDecision =
  | { readonly outcome: 'reset'; readonly reason: ResetIntent['reason'] }
  | { readonly outcome: 'refuse'; readonly reason: ResetRefusalReason };

/**
 * Names the ordered stage a reset failed in.
 *
 * Only the stage, never the raw error: a port rejection can carry a file path, a SQL statement, or
 * a connection detail, and none of those belong in a diagnostic a user or log can read.
 */
export type DatabaseResetStage =
  | 'intent_read'
  | 'intent_write'
  | 'stop_native_writers'
  | 'close_connections'
  | 'database_probe'
  | 'database_delete'
  | 'database_prepare'
  | 'intent_clear';

/** Defines the terminal answer of one reset attempt. */
export type DatabaseResetOutcome =
  | { readonly status: 'refused'; readonly reason: ResetRefusalReason }
  | { readonly status: 'completed'; readonly deleted: boolean }
  | { readonly status: 'failed'; readonly stage: DatabaseResetStage };

/**
 * Defines the side effects a reset orchestrates, every one of them injected by the caller.
 *
 * Nothing here reaches the network, the Bridge, React, or a filesystem directly, and the module
 * imports none of them. `deleteDatabase` is called by name through whatever API the adapter wraps
 * (Expo SDK's `deleteDatabaseAsync` / Android's `SQLiteDatabase.deleteDatabase`), so sidecar files
 * are the API's concern and this module never deletes a file by hand.
 */
export interface DatabaseResetPorts {
  /** Reads the persisted reset intent as raw data; the schema decides whether it is usable. */
  readonly readResetIntent: () => Promise<unknown>;
  /** Persists a validated reset intent before any destructive step. */
  readonly writeResetIntent: (intent: ResetIntent) => Promise<void>;
  /** Removes the reset intent once destruction has completed. */
  readonly clearResetIntent: () => Promise<void>;
  /** Reports whether the application database still exists, so a resumed run never deletes twice. */
  readonly isDatabasePresent: () => Promise<boolean>;
  /** Stops native background writers (WorkManager floor, foreground service) first. */
  readonly stopNativeWriters: () => Promise<void>;
  /** Closes every open connection, including the Expo provider, before deletion. */
  readonly closeDatabaseConnections: () => Promise<void>;
  /** Deletes the named database through the SQLite/Android API, sidecars included. */
  readonly deleteDatabase: (databaseName: string) => Promise<void>;
  /** Opens a fresh database and prepares it; this module never stamps readiness itself. */
  readonly openAndPrepare: () => Promise<void>;
  /** Supplies the intent timestamp; injected so the orchestrator stays deterministic under test. */
  readonly now: () => number;
}

/** Defines the collapse-safe entry point of the resumable reset boundary. */
export interface DatabaseResetOrchestrator {
  /** Runs one reset attempt, collapsing a concurrent duplicate onto the in-flight operation. */
  readonly run: (input: ResetDecisionInput) => Promise<DatabaseResetOutcome>;
}
